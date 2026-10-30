// Media Cloud with one search per language instead of two: what the discovery would try and keep.
// For each interest of the profiles given and each language Media Cloud has press of: the media it names
// for both searches (A, as now: their counts added) and for the first one only (B). The candidates are
// the ones the discovery would try (new for a profile without feeds of its own, not named by Google
// News), the 3 first per language; each medium of A or B is tried once as discovery-service.js does
// (knownFeeds + findFeeds + isOnSubject + the AI), and each side keeps the first 2 kept of its 3.
// Writes nothing. node --env-file=.env bench/mc-one-search.mjs 482 4 290 129
import process from 'node:process';
import fs from 'node:fs/promises';
import {prisma} from '../config/db.js';
import {ProfileModel} from '../models/profile-model.js';
import {knownMedia} from '../services/source-service.js';
import {search} from '../services/utils/google-news.js';
import {knownFeeds, mediaFor} from '../services/utils/media-cloud.js';
import {findFeeds, isOnSubject} from '../services/utils/feed-finder.js';
import {judgeOf} from '../services/utils/meaning-judge.js';
import {parseVector} from '../services/utils/embedder.js';
import {nameOf} from '../services/utils/public-url.js';
import {confirmOnSubject, parseSearch} from '../services/utils/profile-ai.js';

const MC_LANGUAGES = new Set(['fr', 'en', 'de', 'es', 'it']);
const TRIED = 3;
const KEPT = 2;
const report = [];
const log = (line) => { console.log(line); report.push(line); };
const started = Date.now();
const totals = {searchesA: 0, searchesB: 0, keptA: 0, keptB: 0, keptBoth: 0, triedA: 0, triedB: 0, triedSame: 0};

const add = (into, media) => {
    for (const medium of media) {
        const key = nameOf(medium.site);
        const known = into.get(key) ?? {...medium, news: 0};
        known.news += medium.news;
        into.set(key, known);
    }
};
const ranked = (map) => [...map.values()].sort((a, b) => b.news - a.news);

for (const userId of process.argv.slice(2).map(Number)) {
    const interests = await ProfileModel.interestsForDiscovery(userId);
    // a profile without feeds of its own, as at its signup: only the shared feeds are known
    const known = await knownMedia(userId, {userFeeds: []});
    const judge = judgeOf(interests.map(interest => parseVector(interest.dense)));
    const texts = interests.map(interest => interest.text);
    log(`\n=== user ${userId}: ${interests.length} interests`);

    for (const interest of interests) {
        const subject = [interest.keywords, ...interest.sections].filter(Boolean);
        const searches = interest.searches.map(parseSearch).filter(Boolean);
        const byGoogle = new Set();
        for (const {lang, q} of searches) {
            const found = await search([q], {days: 7, language: lang}).catch(() => ({media: []}));
            found.media.forEach(medium => byGoogle.add(nameOf(medium.site)));
        }
        log(`\n-- interest ${interest.position}: ${interest.text.slice(0, 90)}`);

        const tried = new Map();      // site -> kept feed or null
        const tryMedium = async (medium) => {
            const key = nameOf(medium.site);
            if (tried.has(key)) return tried.get(key);
            const listed = await knownFeeds(medium.site);
            const feed = await findFeeds(medium.site, {language: medium.lang, subject, judge, known: listed}).then(feeds => feeds[0], () => null);
            let kept = null;
            if (feed && isOnSubject(feed)) {
                const confirmed = await confirmOnSubject(texts, (feed.onSubjectTitles ?? []).slice(0, 12)).catch(() => null);
                if (!confirmed || isOnSubject({onSubject: confirmed.size})) kept = feed.url;
            }
            tried.set(key, kept);
            return kept;
        };

        const byLanguage = Map.groupBy(searches.filter(search => MC_LANGUAGES.has(search.lang)), search => search.lang);
        for (const [lang, ofLanguage] of byLanguage) {
            const both = new Map();
            const first = new Map();
            for (const [i, {q}] of ofLanguage.entries()) {
                const media = await mediaFor(q, {language: lang});
                add(both, media);
                if (i === 0) add(first, media);
            }
            totals.searchesA += ofLanguage.length;
            totals.searchesB += 1;
            const candidates = (media) => ranked(media).filter(medium => !known.has(nameOf(medium.site)) && !byGoogle.has(nameOf(medium.site))).slice(0, TRIED);
            const triedA = candidates(both);
            const triedB = candidates(first);
            const keptOf = async (list) => {
                const kept = [];
                for (const medium of list) {
                    const feed = await tryMedium(medium);
                    if (feed && kept.length < KEPT) kept.push(`${medium.site}`);
                }
                return kept;
            };
            const keptA = await keptOf(triedA);
            const keptB = await keptOf(triedB);
            const namesA = triedA.map(medium => medium.site);
            const namesB = triedB.map(medium => medium.site);
            totals.triedA += namesA.length;
            totals.triedB += namesB.length;
            totals.triedSame += namesA.filter(name => namesB.includes(name)).length;
            totals.keptA += keptA.length;
            totals.keptB += keptB.length;
            totals.keptBoth += keptA.filter(name => keptB.includes(name)).length;
            log(`   ${lang} [${ofLanguage.map(search => search.q).join(' | ')}]: media A ${both.size}, B ${first.size}`);
            log(`      tried A: ${namesA.join(', ') || '-'}   kept A: ${keptA.join(', ') || 'none'}`);
            log(`      tried B: ${namesB.join(', ') || '-'}   kept B: ${keptB.join(', ') || 'none'}`);
        }
    }
}

log(`\nTOTAL ${JSON.stringify(totals)}; Media Cloud queue: A ${Math.round(totals.searchesA * 31 / 60)} min, B ${Math.round(totals.searchesB * 31 / 60)} min; bench ${Math.round((Date.now() - started) / 60e3)} min`);
await fs.writeFile(new URL('./data/mc-one-search.txt', import.meta.url), report.join('\n'));
await prisma.$disconnect();
process.exit(0);
