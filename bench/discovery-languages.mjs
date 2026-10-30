// Why a profile reading French gets no French source: the discovery of a user replayed step by step,
// nothing saved. Per interest: the media Google News names for each search (with its language), the
// ones tried, and what findFeeds answered for each.
// node bench/discovery-languages.mjs <userId> [<userId>...]   -> bench/data/discovery-languages/<userId>.json
import 'dotenv/config';
import fs from 'node:fs';
import {ProfileModel} from '../models/profile-model.js';
import {FeedModel} from '../models/feed-model.js';
import {knownMedia} from '../services/source-service.js';
import {search} from '../services/utils/google-news.js';
import {findFeeds, isOnSubject, subjectScore} from '../services/utils/feed-finder.js';
import {embed, denseSimilarity, parseVector} from '../services/utils/embedder.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';
import {nameOf} from '../services/utils/public-url.js';
import {parseSearch} from '../services/utils/profile-ai.js';
import {JUDGE_THRESHOLD} from '../services/discovery-service.js';

const DIR = 'bench/data/discovery-languages';
fs.mkdirSync(DIR, {recursive: true});

for (const userId of process.argv.slice(2).map(Number)) {
    const [interests, profile] = await Promise.all([ProfileModel.interestsForDiscovery(userId), ProfileModel.get(userId)]);
    // as the discovery sees it now: its own feeds count as known
    const known = await knownMedia(userId, {userFeeds: await FeedModel.userFeedUrls(userId)});
    const cache = new Map();
    const denses = interests.map(i => parseVector(i.dense));
    const judge = async (texts) => {
        const missing = [...new Set(texts.filter(t => !cache.has(t)))];
        if (missing.length) (await embed(missing)).forEach((v, i) => cache.set(missing[i], v.dense));
        return texts.map(t => denses.some(d => denseSimilarity(cache.get(t), d) >= JUDGE_THRESHOLD));
    };
    const report = {userId, languages: profile.languages, interests: []};
    console.log(`\n##### user ${userId} (${profile.languages.join('+')})`);

    for (const interest of interests) {
        console.log(`\n== ${interest.text.slice(0, 80)}`);
        const media = new Map();
        const perSearch = [];
        for (const {lang, q} of interest.searches.map(parseSearch).filter(Boolean)) {
            const found = await search([q], {days: 7, language: lang}).catch(err => ({media: [], news: [], error: err.message}));
            perSearch.push({lang, q, news: found.news?.length ?? 0, media: found.media.length, error: found.error});
            console.log(`  search ${lang}:"${q}" -> ${found.news?.length ?? 0} news, ${found.media.length} media${found.error ? ' ERROR ' + found.error : ''}`);
            for (const m of found.media) {
                const key = nameOf(m.site);
                const k = media.get(key) ?? {site: m.site, news: 0, lang, langs: new Set()};
                k.news += m.news;
                k.langs.add(lang);
                media.set(key, k);
            }
        }
        const sorted = [...media.values()].sort((a, b) => b.news - a.news);
        const candidates = sorted.filter(m => !known.has(nameOf(m.site)));
        const tried = candidates.slice(0, 6);
        const byLang = (list) => ['fr', 'en'].map(l => `${l} ${list.filter(m => m.lang === l).length}`).join(', ');
        console.log(`  media ${sorted.length} (${byLang(sorted)}), not known ${candidates.length} (${byLang(candidates)}), tried 6: ${byLang(tried)}`);
        console.log(`  known French media dropped: ${sorted.filter(m => m.lang === 'fr' && known.has(nameOf(m.site))).slice(0, 12).map(m => `${m.site}(${m.news})`).join(', ')}`);
        console.log(`  first French media not known: ${candidates.filter(m => m.lang === 'fr').slice(0, 10).map(m => `${m.site}(${m.news}) #${candidates.indexOf(m) + 1}`).join(', ')}`);

        // what findFeeds answers for the 6 tried and for the first 6 French ones not known
        const frFirst = candidates.filter(m => m.lang === 'fr').slice(0, 6);
        const toCheck = [...new Map([...tried, ...frFirst].map(m => [nameOf(m.site), m])).values()];
        const subject = [interest.keywords, ...interest.sections].filter(Boolean);
        const results = await mapWithConcurrency(toCheck, 3, m => findFeeds(m.site, {language: m.lang, subject, judge, languages: profile.languages}));
        const checked = toCheck.map((m, i) => {
            const r = results[i];
            const feed = r.status === 'fulfilled' ? r.value[0] : null;
            const verdict = r.status === 'rejected' ? `failed: ${r.reason?.message}` : !feed ? 'no feed'
                : isOnSubject(feed) ? `KEPT ${feed.onSubject}/${feed.judged} on subject, ${feed.language}` : `off subject ${feed.onSubject}/${feed.judged}, ${feed.language}`;
            console.log(`  ${tried.includes(m) ? 'T' : ' '} ${m.lang} ${m.site} (${m.news} news): ${verdict}${feed ? ' ' + feed.url.slice(0, 90) : ''}`);
            return {site: m.site, lang: m.lang, news: m.news, tried: tried.includes(m), verdict, feed: feed?.url ?? null, score: feed ? subjectScore(feed) : 0};
        });
        report.interests.push({text: interest.text, perSearch, media: sorted.slice(0, 30).map(m => ({...m, langs: [...m.langs], known: known.has(nameOf(m.site))})), checked});
    }
    fs.writeFileSync(`${DIR}/${userId}.json`, JSON.stringify(report, null, 1));
}
process.exit(0);
