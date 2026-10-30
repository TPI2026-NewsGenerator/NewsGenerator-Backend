// What "Look on the web" and the web part of the source search give, and what they would give with
// the feeds judged by meaning (A) and the news of Google sorted by the AI first (A+B). The answers of
// Google News and GDELT are kept in bench/data/web-quality/raw so every variant reads the same ones.
// node --env-file=.env [--env-file=local-embedder.env] bench/web-quality.mjs [userId]
//   -> bench/data/web-quality/report.json and a text report on stdout
import 'dotenv/config';
import fs from 'node:fs';
import {search} from '../services/utils/google-news.js';
import {mediaFor as gdeltMedia} from '../services/utils/gdelt.js';
import {knownMedia} from '../services/source-service.js';
import {findFeeds, isOnSubject} from '../services/utils/feed-finder.js';
import {embed, denseSimilarity} from '../services/utils/embedder.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';
import {nameOf} from '../services/utils/public-url.js';
import {sortByMeaning} from '../services/utils/search-ai.js';
import {JUDGE_THRESHOLD} from '../services/discovery-service.js';

const DIR = 'bench/data/web-quality';
fs.mkdirSync(`${DIR}/raw`, {recursive: true});
const userId = Number(process.argv[2] ?? 4);
const MAX_CANDIDATES = 8;
const MAX_NEWS = 25;

// the sentences of the search page (7 days) and the words of the source search of the profile (30 days)
const QUERIES = [
    {q: "les décisions de l'arbitrage vidéo en Ligue 1", language: 'fr', days: 7},
    {q: "l'intelligence artificielle à l'hôpital", language: 'fr', days: 7},
    {q: 'VAR decisions in the Champions League', language: 'en', days: 7},
    {q: 'the latest AI models for programming', language: 'en', days: 7},
    {q: 'arbitrage football', language: 'fr', days: 30},
    {q: 'rugby top 14', language: 'fr', days: 30},
    {q: 'cartes Pokémon', language: 'fr', days: 30},
    {q: 'premier league', language: 'en', days: 30},
    {q: 'trading card games', language: 'en', days: 30},
];

const slug = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

const mergeMedia = (...lists) => {
    const media = new Map();
    for (const medium of lists.flat()) {
        const found = media.get(nameOf(medium.site));
        if (found) found.news += medium.news;
        else media.set(nameOf(medium.site), {...medium});
    }
    return [...media.values()].sort((a, b) => b.news - a.news);
};

const raw = async ({q, language, days}) => {
    const file = `${DIR}/raw/${slug(q)}-${language}-${days}.json`;
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    const [google, gdelt] = await Promise.all([
        search([q], {days, language}),
        gdeltMedia([q], {days: Math.min(days, 7), language}).catch(() => []),
    ]);
    const answer = {google, gdelt};
    fs.writeFileSync(file, JSON.stringify(answer, null, 1));
    return answer;
};

const known = await knownMedia(userId);
const feedCache = new Map();
const report = [];

for (const query of QUERIES) {
    const {google, gdelt} = await raw(query);
    const isMissing = (site) => !known.has(nameOf(site));
    const [queryVector] = await embed([query.q]);
    const vectors = new Map();
    const meaningJudge = async (texts) => {
        const missing = [...new Set(texts.filter(text => !vectors.has(text)))];
        if (missing.length > 0) (await embed(missing)).forEach((vector, i) => vectors.set(missing[i], vector.dense));
        return texts.map(text => denseSimilarity(vectors.get(text), queryVector.dense) >= JUDGE_THRESHOLD);
    };
    const feedOf = (site, meaning) => {
        const key = `${query.q}|${site}|${meaning}`;
        if (!feedCache.has(key)) {
            feedCache.set(key, findFeeds(site, {language: query.language, subject: [query.q], ...(meaning ? {judge: meaningJudge} : {})})
                .then(feeds => feeds[0] ?? null, () => null));
        }
        return feedCache.get(key);
    };
    const sourcesOf = async (candidates, meaning) => {
        const feeds = await mapWithConcurrency(candidates, 4, medium => feedOf(medium.site, meaning));
        return candidates.map((medium, i) => ({medium, feed: feeds[i].status === 'fulfilled' ? feeds[i].value : null}))
            .filter(({feed}) => feed && (!meaning || isOnSubject(feed)))
            .map(({medium, feed}) => ({site: medium.site, news: medium.news, feed: feed.url, onSubject: feed.onSubject ?? null,
                judged: feed.judged ?? null, titles: feed.titles ?? []}));
    };

    const missingNews = google.news.filter(item => isMissing(item.site))
        .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));

    // base: as today
    const baseCandidates = mergeMedia(google.media, gdelt).filter(m => isMissing(m.site)).slice(0, MAX_CANDIDATES);
    const base = {news: missingNews.slice(0, MAX_NEWS).map(n => `${n.name} | ${n.title}`), candidates: baseCandidates.map(m => m.site),
        sources: await sourcesOf(baseCandidates, false)};

    // A: the same media, their feed judged by meaning and kept only on the subject
    const a = {sources: await sourcesOf(baseCandidates, true)};

    // A+B: the news of Google sorted by the AI first, the media counted on the answers only
    const started = Date.now();
    const sorted = await sortByMeaning(query.q, google.news.map((n, id) => ({id, title: n.title, description: ''})))
        .catch(err => ({answers: [], related: [], error: err.message}));
    const aiSeconds = (Date.now() - started) / 1000;
    const answers = sorted.answers.map(Number);
    const related = sorted.related.map(Number);
    const mediaOfNews = (ids) => [...ids.map(id => google.news[id]).filter(Boolean).reduce((media, n) => {
        const m = media.get(n.site) ?? {site: n.site, name: n.name, news: 0};
        m.news++;
        return media.set(n.site, m);
    }, new Map()).values()].sort((x, y) => y.news - x.news);
    const abCandidates = mediaOfNews(answers).filter(m => isMissing(m.site)).slice(0, MAX_CANDIDATES);
    const shown = [...answers, ...related].map(id => google.news[id]).filter(n => n && isMissing(n.site));
    const ab = {aiSeconds, answers: answers.length, related: related.length, of: google.news.length, error: sorted.error,
        news: shown.slice(0, MAX_NEWS).map(n => `${answers.includes(google.news.indexOf(n)) ? 'A' : 'r'} ${n.name} | ${n.title}`),
        dropped: google.news.filter((n, id) => !answers.includes(id) && !related.includes(id) && isMissing(n.site)).slice(0, 15).map(n => `${n.name} | ${n.title}`),
        candidates: abCandidates.map(m => m.site), sources: await sourcesOf(abCandidates, true)};
    // B2: the media counted on the answers and the news close to them, only the ones off it are left out
    const b2Candidates = mediaOfNews([...answers, ...related]).filter(m => isMissing(m.site)).slice(0, MAX_CANDIDATES);
    const b2 = {candidates: b2Candidates.map(m => m.site), sources: await sourcesOf(b2Candidates, true)};

    report.push({...query, googleNews: google.news.length, gdeltMedia: gdelt.length, base, a, ab, b2});
    fs.writeFileSync(`${DIR}/report.json`, JSON.stringify(report, null, 1));

    const line = (s) => `    ${s.site} (${s.news}) ${s.onSubject ?? '-'}/${s.judged ?? '-'} ${s.feed.slice(0, 80)}\n      e.g. ${s.titles.slice(0, 2).map(t => t.slice(0, 70)).join(' // ')}`;
    console.log(`\n===== ${query.language} ${query.days}d "${query.q}": Google ${google.news.length} news, GDELT ${gdelt.length} media`);
    console.log(`  BASE news shown ${base.news.length}:\n${base.news.map(n => '    ' + n.slice(0, 110)).join('\n')}`);
    console.log(`  BASE candidates: ${base.candidates.join(', ')}\n  BASE sources ${base.sources.length}:\n${base.sources.map(line).join('\n')}`);
    console.log(`  A sources ${a.sources.length}:\n${a.sources.map(line).join('\n')}`);
    console.log(`  AB: AI ${ab.aiSeconds}s, ${ab.answers} answers + ${ab.related} related of ${ab.of}${ab.error ? ' ERROR ' + ab.error : ''}`);
    console.log(`  AB news shown ${ab.news.length}:\n${ab.news.map(n => '    ' + n.slice(0, 110)).join('\n')}`);
    console.log(`  AB dropped (first 15):\n${ab.dropped.map(n => '    ' + n.slice(0, 110)).join('\n')}`);
    console.log(`  AB candidates: ${ab.candidates.join(', ')}\n  AB sources ${ab.sources.length}:\n${ab.sources.map(line).join('\n')}`);
    console.log(`  B2 candidates: ${b2.candidates.join(', ')}\n  B2 sources ${b2.sources.length}:\n${b2.sources.map(line).join('\n')}`);
}
process.exit(0);
