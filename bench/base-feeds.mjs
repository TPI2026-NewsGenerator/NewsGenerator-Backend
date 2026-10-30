// What the hard-coded feeds (db/rss-links.js) bring, and what would be lost without the English sport
// ones (270 of 415): their volume, the briefing candidates of the test profiles, the answers of the
// search, the media counted on a story. A feed some reader also added stays read for them.
// node bench/base-feeds.mjs   -> bench/data/base-feeds/report.txt
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';
import {rss} from '../db/rss-links.js';
import Links from '../services/utils/links.js';
import {StoryModel} from '../models/story-model.js';
import {FeedModel} from '../models/feed-model.js';
import {ProfileModel} from '../models/profile-model.js';
import {searchesOfUser} from '../services/ingest-service.js';
import {credibleStory, pickCandidates} from '../services/utils/google-news.js';

const DIR = 'bench/data/base-feeds';
fs.mkdirSync(DIR, {recursive: true});
const USERS = [4, 129, 154, 290];
const out = [];
const log = (line = '') => { out.push(line); console.log(line); };

const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();

// the groups: language/category, the English sport ones split by kind
const kindOf = (url) => url.includes('youtube.com') ? 'youtube'
    : url.includes('podcasts.files.bbci') ? 'podcast'
    : url.includes('feeds.bbci.co.uk') ? 'bbc' : 'other';
const groupOf = new Map();
for (const [language, categories] of Object.entries(rss)) {
    for (const [category, urls] of Object.entries(categories)) {
        for (const url of urls) {
            if (!groupOf.has(url)) groupOf.set(url, language === 'en' && category === 'sport' ? `en/sport:${kindOf(url)}` : `${language}/${category}`);
        }
    }
}
const enSport = new Set(rss.en.sport);
const userFeeds = new Set((await db.query('SELECT DISTINCT url FROM user_feeds')).rows.map(r => r.url));
// KINDS=youtube,bbc,podcast removes only those kinds of English sport feeds
const kinds = process.env.KINDS ? process.env.KINDS.split(',') : null;
const removed = new Set([...enSport].filter(url => !userFeeds.has(url) && (!kinds || kinds.includes(kindOf(url)))));
log(`English sport feeds: ${enSport.size}, also added by a reader: ${enSport.size - removed.size}, so ${removed.size} would stop being read${kinds ? ` (only ${kinds.join(', ')})` : ''}`);

// 1. volume of the last 7 days: news, and news no other feed brings (same link)
const since7 = new Date(Date.now() - 7 * 86400e3);
const rows = (await db.query(`
    SELECT f.url, a.link, a.embedded_at IS NOT NULL AS embedded
    FROM articles a JOIN feeds f ON f.id = a.id_feed
    WHERE COALESCE(a.published_at, a.created_at) >= $1`, [since7])).rows;
const feedsOfLink = new Map();
for (const r of rows) {
    if (!feedsOfLink.has(r.link)) feedsOfLink.set(r.link, new Set());
    feedsOfLink.get(r.link).add(r.url);
}
const groupOfFeed = (url) => groupOf.get(url) ?? (url.startsWith('https://news.google.com/') ? 'google news' : 'readers\' feeds');
const volume = new Map();
for (const [link, urls] of feedsOfLink) {
    const groups = new Set([...urls].map(groupOfFeed));
    for (const g of groups) {
        const v = volume.get(g) ?? {news: 0, only: 0};
        v.news++;
        if (groups.size === 1) v.only++;
        volume.set(g, v);
    }
}
const feedCount = new Map();
for (const g of groupOf.values()) feedCount.set(g, (feedCount.get(g) ?? 0) + 1);
log(`\n== 1. news of the last 7 days (distinct links), and the ones no other group brings`);
log(`total ${feedsOfLink.size}`);
for (const [g, v] of [...volume].sort((a, b) => b[1].news - a[1].news)) {
    log(`${g.padEnd(22)} feeds ${String(feedCount.get(g) ?? '-').padStart(4)}  news ${String(v.news).padStart(6)}  only there ${String(v.only).padStart(6)}`);
}
const lostLinks = [...feedsOfLink].filter(([, urls]) => [...urls].every(url => removed.has(url))).length;
log(`without the English sport feeds: ${lostLinks} news of ${feedsOfLink.size} not read any more (${(100 * lostLinks / feedsOfLink.size).toFixed(1)}%)`);

// 2. the briefing: the candidates of each profile now, with and without them (no AI)
log(`\n== 2. briefing candidates (48 h, 40 from the feeds + 10 Google News, as the briefing picks them)`);
const media = new Set(await FeedModel.feedMedia());
const since48 = new Date(Date.now() - 48 * 3600e3);
const candidatesOf = async (userId, profile, feedUrls) => {
    const ranked = await StoryModel.rank({userId, feedUrls, since: since48, languages: profile.languages, sparseWeight: 0.5, excluded: [], limit: 150});
    const members = new Map(ranked.map(r => [r.id_story, []]));
    for (const a of await StoryModel.storyArticles({storyIds: [...members.keys()], feedUrls, since: since48})) members.get(a.id_story).push(a);
    const stories = ranked.map(r => ({storyId: r.id_story, score: Number(r.score), best: members.get(r.id_story).find(a => a.id === r.id_article), members: members.get(r.id_story)}));
    return pickCandidates(stories.filter(s => s.best && credibleStory(s.members, media)).sort((a, b) => b.score - a.score), {fromFeeds: 40, extra: 10, perMedium: 2});
};
for (const userId of USERS) {
    const profile = await ProfileModel.get(userId);
    if (!profile) continue;
    const own = new Set(await FeedModel.userFeedUrls(userId));
    const all = [...new Set([...profile.languages.flatMap(l => Object.values(rss[l] ?? {}).flat()), ...own, ...await searchesOfUser(userId)])];
    const without = all.filter(url => !removed.has(url) || own.has(url));
    const before = await candidatesOf(userId, profile, all);
    const after = await candidatesOf(userId, profile, without);
    const afterIds = new Set(after.map(s => s.storyId));
    const beforeIds = new Set(before.map(s => s.storyId));
    const bySport = before.filter(s => s.members.some(a => enSport.has(a.feed_url)));
    log(`\nuser ${userId} (${profile.languages.join('+')}): ${before.length} candidates, ${bySport.length} with an English sport feed among their news, ${before.filter(s => !afterIds.has(s.storyId)).length} lost, ${after.filter(s => !beforeIds.has(s.storyId)).length} come in instead`);
    for (const s of before.filter(s => !afterIds.has(s.storyId))) log(`   - ${s.score.toFixed(3)} ${s.best.title.slice(0, 100)}  [${[...new Set(s.members.map(a => groupOfFeed(a.feed_url)))].join(', ')}]`);
    for (const s of after.filter(s => !beforeIds.has(s.storyId))) log(`   + ${s.score.toFixed(3)} ${s.best.title.slice(0, 100)}`);

    // the cards of the last briefing of this reader
    const last = (await db.query('SELECT id, items FROM briefings WHERE id_user = $1 AND status = $2 ORDER BY id DESC LIMIT 1', [userId, 'ready'])).rows[0];
    if (last) {
        const cards = last.items;
        const gone = cards.filter(card => (card.feedUrls ?? []).length > 0 && card.feedUrls.every(url => removed.has(url) && !own.has(url)));
        log(`   last briefing #${last.id}: ${cards.length} cards, ${cards.filter(c => (c.feedUrls ?? []).some(u => enSport.has(u))).length} told by an English sport feed, ${gone.length} only by them`);
        for (const card of gone) log(`     only English sport: ${card.title.slice(0, 100)}`);
    }
}

// 3. the search (en, all categories, 7 days): the stories naming a subject in their title, and the ones
// only English sport feeds tell. By keywords: the embedder needed by the search by sentence may be off
log(`
== 3. search (en, all categories, 7 days): stories whose title names the subject`);
const SUBJECTS = [
    ['Premier League', String.raw`\mpremier league\M`], ['Champions League', String.raw`\mchampions league\M`], ['NFL', String.raw`\mnfl\M`],
    ['Formula 1', String.raw`\m(formula (1|one)|f1)\M`], ['cricket', String.raw`\mcricket`], ['boxing', String.raw`\mboxing\M|\mboxer`],
    ['tennis', String.raw`\mtennis\M`], ['rugby', String.raw`\mrugby\M`], ['golf', String.raw`\mgolf\M`], ['NBA', String.raw`\mnba\M`],
    ['MMA/UFC', String.raw`\m(mma|ufc)\M`], ['cycling', String.raw`\mcycling\M|tour de france`],
    ['Federal Reserve', String.raw`\mfederal reserve\M|\mthe fed\M`], ['wildfire', String.raw`\mwildfire`], ['OpenAI', String.raw`\mopenai\M`],
];
const searchFeeds = Links.getCategoriesLinks(Links.categories('en'), 'en');
for (const [name, pattern] of SUBJECTS) {
    const {rows} = await db.query(`
        SELECT COALESCE(a.id_story::text, a.link) AS story, f.url, a.medium
        FROM articles a JOIN feeds f ON f.id = a.id_feed
        WHERE f.url = ANY($1) AND COALESCE(a.published_at, a.created_at) >= $2 AND a.title ~* $3`, [searchFeeds, since7, pattern]);
    const stories = new Map();
    for (const r of rows) {
        if (!stories.has(r.story)) stories.set(r.story, {feeds: new Set(), media: new Set(), keptMedia: new Set()});
        const st = stories.get(r.story);
        st.feeds.add(r.url);
        st.media.add(r.medium);
        if (!removed.has(r.url)) st.keptMedia.add(r.medium);
    }
    const all = [...stories.values()];
    const lost = all.filter(st => [...st.feeds].every(url => removed.has(url))).length;
    const media = new Set(all.flatMap(st => [...st.media]));
    const keptMedia = new Set(all.flatMap(st => [...st.keptMedia]));
    log(`${name.padEnd(18)} stories ${String(all.length).padStart(4)}, only English sport ${String(lost).padStart(4)} (${all.length ? Math.round(100 * lost / all.length) : 0}%)   media ${media.size} -> ${keptMedia.size}`);
}

// 4. the media counted on a story (English stories of the last 7 days)
log(`\n== 4. media per English story (7 days)`);
const storyRows = (await db.query(`
    SELECT a.id_story, a.medium, f.url
    FROM articles a JOIN feeds f ON f.id = a.id_feed JOIN stories s ON s.id = a.id_story
    WHERE s.lang = 'en' AND COALESCE(a.published_at, a.created_at) >= $1 AND a.medium IS NOT NULL`, [since7])).rows;
const perStory = new Map();
for (const r of storyRows) {
    if (!perStory.has(r.id_story)) perStory.set(r.id_story, {all: new Set(), kept: new Set()});
    const s = perStory.get(r.id_story);
    s.all.add(r.medium);
    if (!removed.has(r.url)) s.kept.add(r.medium);
}
const stories = [...perStory.values()];
for (const n of [2, 3]) {
    const had = stories.filter(s => s.all.size >= n);
    log(`told by ${n}+ media: ${had.length} stories, ${had.filter(s => s.kept.size < n).length} fall below without English sport`);
}
log(`stories not told at all any more: ${stories.filter(s => s.kept.size === 0).length} of ${stories.length}`);

fs.writeFileSync(`${DIR}/report${kinds ? '-' + kinds.join('-') : ''}.txt`, out.join('\n'));
await db.end();
process.exit(0);
