// Media Cloud against Google News for the discovery of the sources of a profile.
// For each interest and language of the profiles: the media Media Cloud names for its searches
// (last 30 days, the national and local collections of the language), the ones Google News named
// (the news of its searches in the cache), the ones already read. Then the media only Media Cloud
// names are tried like the discovery tries a medium (findFeeds + isOnSubject), and the feeds the
// directory of Media Cloud knows for them are listed.
// node --env-file=.env bench/mc-measure.mjs 290 311 4
import process from 'node:process';
import fs from 'node:fs/promises';
import {prisma} from '../config/db.js';
import {ProfileModel} from '../models/profile-model.js';
import {knownMedia} from '../services/source-service.js';
import {parseSearch} from '../services/utils/profile-ai.js';
import {interestSearchUrls, isPlatform} from '../services/utils/google-news.js';
import {findFeeds, isOnSubject} from '../services/utils/feed-finder.js';
import {judgeOf} from '../services/utils/meaning-judge.js';
import {parseVector} from '../services/utils/embedder.js';
import {nameOf} from '../services/utils/public-url.js';

const H = {Authorization: `Token ${process.env.MEDIACLOUD_API_TOKEN}`, Accept: 'application/json'};
let calls = 0;
// its searches: 2 a minute (search/api-params says "query-rate": "2/m")
let lastSearch = 0;
const SEARCH_GAP_MS = 31000;
const mc = async (path, params) => {
    calls++;
    if (path.startsWith('search/')) {
        const wait = lastSearch + SEARCH_GAP_MS - Date.now();
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
        lastSearch = Date.now();
    }
    const res = await fetch(`https://search.mediacloud.org/api/${path}?${new URLSearchParams(params)}`, {headers: H, signal: AbortSignal.timeout(60000)});
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.json();
};

const COLLECTIONS = {
    fr: [34412146, 38379799, 34411591, 38380954, 34412298],   // France, Switzerland, Belgium
    en: [34412234, 34412476, 38381111],                       // United States, United Kingdom
};
const DAYS = 30;
const TRY_PER_LANGUAGE = 5;
const end = new Date().toISOString().slice(0, 10);
const start = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10);
// Media Cloud searches the whole text, its words OR'ed by default; "TCG AND news" found any sport
// page saying "news": the words of a search asked together, as a phrase
const mcQuery = (q) => {
    const words = q.trim().replace(/[():"]/g, '').split(/\s+/).filter(Boolean);
    return words.length > 1 ? `"${words.join(' ')}"` : words[0];
};

const report = [];
const log = (line) => { console.log(line); report.push(line); };

for (const userId of process.argv.slice(2).map(Number)) {
    const profile = await ProfileModel.get(userId);
    const languages = profile?.languages?.length ? profile.languages : ['en'];
    const interests = await ProfileModel.interestsForDiscovery(userId);
    const known = await knownMedia(userId);
    const judge = judgeOf(interests.map(interest => parseVector(interest.dense)));
    log(`\n=== user ${userId} (${languages.join(', ')}), ${interests.length} interests, ${known.size} media known`);

    for (const interest of interests) {
        const subject = [interest.keywords, ...interest.sections].filter(Boolean);
        for (const lang of languages.filter(l => COLLECTIONS[l])) {
            const searches = interest.searches.map(parseSearch).filter(s => s && s.lang === lang);
            if (searches.length === 0) continue;
            const mcMedia = new Map();
            for (const {q} of searches) {
                try {
                    const {sources} = await mc('search/sources', {q: mcQuery(q), start, end, platform: 'onlinenews-mediacloud', cs: COLLECTIONS[lang].join(',')});
                    for (const {source, count} of sources ?? []) mcMedia.set(nameOf(source), {site: source, news: (mcMedia.get(nameOf(source))?.news ?? 0) + count});
                } catch (err) {
                    log(`  Media Cloud failed for "${q}": ${err.message}`);
                }
            }
            const urls = interestSearchUrls(interest.searches, [lang]);
            const google = new Set((await prisma.$queryRawUnsafe(`
                SELECT DISTINCT a.medium FROM articles a JOIN feeds f ON f.id = a.id_feed
                WHERE f.url = ANY($1::text[]) AND a.medium IS NOT NULL`, urls)).map(row => nameOf(row.medium)));

            const all = [...mcMedia.values()].filter(m => !isPlatform(`https://${m.site}`)).sort((a, b) => b.news - a.news);
            const both = all.filter(m => google.has(nameOf(m.site)));
            const newOnes = all.filter(m => !google.has(nameOf(m.site)) && !known.has(nameOf(m.site)));
            log(`\n-- ${interest.text.slice(0, 70)} [${lang}] searches: ${searches.map(s => s.q).join(' | ')}`);
            log(`   Media Cloud: ${all.length} media (${both.length} also by Google, ${newOnes.length} new to us); Google News: ${google.size} media`);
            log(`   Media Cloud top: ${all.slice(0, 12).map(m => `${m.site}(${m.news})`).join(', ')}`);

            for (const medium of newOnes.slice(0, TRY_PER_LANGUAGE)) {
                let verdict;
                try {
                    const feed = (await findFeeds(medium.site, {language: lang, subject, judge, languages}))[0];
                    verdict = !feed ? 'no feed found' : isOnSubject(feed) ? `KEPT ${feed.url}` : `off subject ${feed.url}`;
                } catch (err) {
                    verdict = `failed (${err.message.slice(0, 60)})`;
                }
                let directory = '';
                try {
                    const {results} = await mc('sources/sources/', {name: medium.site, limit: 1});
                    const source = results?.[0];
                    if (source) {
                        const feeds = await mc('sources/feeds/', {source_id: source.id, limit: 5});
                        directory = `MC feeds: ${(feeds.results ?? []).map(f => f.url).join(' ') || 'none'}`;
                    } else directory = 'not in MC directory';
                } catch (err) {
                    directory = `MC directory failed (${err.message.slice(0, 60)})`;
                }
                log(`   try ${medium.site} (${medium.news} news): ${verdict} | ${directory}`);
            }
        }
    }
}
log(`\nMedia Cloud calls: ${calls}`);
await fs.writeFile(new URL('./data/mc-measure.txt', import.meta.url), report.join('\n'));
await prisma.$disconnect();
process.exit(0);
