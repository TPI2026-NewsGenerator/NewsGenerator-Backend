// The pack of stories to rate by hand for the age gate (friend's point 6, 10.11.2026): 40 cards of the saved briefings drawn at random (a fixed
// seed) among the ones whose first news is older than the window of their briefing plus 12 hours. For each: the title the reader reads, the first
// news of the story (what could be known before) and the news of the last 24 h before the briefing (what the card tells), with their ages. The
// pack is read BEFORE any method is run, so that the ratings do not follow what a method says. Writes bench/data/old-news-pack.json and .txt
//   node --env-file=.env bench/old-news-pack.mjs [n=40]
import process from 'node:process';
import {readFileSync, writeFileSync} from 'node:fs';
import pg from 'pg';

const n = Number(process.argv[2] ?? 40);
const cards = JSON.parse(readFileSync('bench/data/old-news-age.json', 'utf8'));
// PACK=2: the stories not in the first pack, a second set to check what was tuned on the first (another seed)
const second = process.env.PACK === '2';
const taken = second ? new Set(JSON.parse(readFileSync('bench/data/old-news-pack.json', 'utf8')).map(item => item.storyId)) : new Set();
const old = cards.filter(card => card.firstAge > card.hours / 24 + 0.5 && !taken.has(card.storyId));

// a fixed seed (mulberry32), so the same pack is drawn again
let seed = second ? 2022 : 1011;
const random = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
// a story once: the same story of the briefings of several profiles counts once
const seen = new Set();
const pool = old.filter(card => !seen.has(card.storyId) && seen.add(card.storyId)).map(card => ({card, k: random()})).sort((a, b) => a.k - b.k).slice(0, n).map(row => row.card);

const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const DAY = 86400e3;
const pack = [];
for (const [i, card] of pool.entries()) {
    const written = new Date(card.written);
    const {rows: [story]} = await c.query(`SELECT id_thread FROM stories WHERE id = $1`, [card.storyId]);
    const {rows: news} = await c.query(`SELECT COALESCE(published_at, created_at) at, medium, lang, left(title, 160) title,
        left(regexp_replace(COALESCE(description, ''), '<[^>]*>', ' ', 'g'), 220) description FROM articles WHERE id_story = $1 AND COALESCE(published_at, created_at) <= $2 ORDER BY 1`, [card.storyId, written]);
    const age = (row) => Math.round((written - new Date(row.at)) / DAY * 10) / 10;
    // one news per medium, the first ones and the last ones
    const perMedium = (rows) => rows.filter((row, at) => rows.findIndex(other => other.medium === row.medium) === at);
    const first = perMedium(news).slice(0, 4).map(row => ({age: age(row), medium: row.medium, lang: row.lang, title: row.title}));
    const lastDay = perMedium(news.filter(row => age(row) <= 1)).slice(-6).map(row => ({age: age(row), medium: row.medium, lang: row.lang, title: row.title}));
    let thread = null;
    if (story?.id_thread) {
        const {rows} = await c.query(`SELECT count(*)::int news, count(DISTINCT a.id_story)::int stories, min(COALESCE(a.published_at, a.created_at)) first
            FROM articles a JOIN stories s ON s.id = a.id_story WHERE s.id_thread = $1 AND COALESCE(a.published_at, a.created_at) <= $2`, [story.id_thread, written]);
        thread = {news: rows[0].news, stories: rows[0].stories, firstAge: Math.round((written - new Date(rows[0].first)) / DAY * 10) / 10};
    }
    // what a briefing of the window would have: the news before its start (the "earlier coverage") and the news inside it, one per medium
    const windowDays = card.hours / 24;
    const asRow = (row) => ({age: age(row), medium: row.medium, lang: row.lang, title: row.title});
    const before = perMedium(news.filter(row => age(row) > windowDays)).slice(0, 5).map(asRow);
    const within = perMedium(news.filter(row => age(row) <= windowDays && age(row) >= 0)).slice(-8).map(asRow);
    const beforeCount = news.filter(row => age(row) > windowDays).length;
    pack.push({n: i + 1, before, within, beforeCount, briefing: card.briefing, storyId: card.storyId, hours: card.hours, written, title: card.title, news: news.length, media: card.media,
        firstAge: Math.round(card.firstAge * 10) / 10, lastAge: Math.round(card.lastAge * 10) / 10, inLastDay: card.inLastDay, thread, first, lastDay});
}
await c.end();
const suffix = second ? '2' : '';
writeFileSync(`bench/data/old-news-pack${suffix}.json`, JSON.stringify(pack, null, 1));
const text = pack.map(item => [
    `#${item.n}  story ${item.storyId}  briefing of ${item.hours} h, written ${new Date(item.written).toISOString().slice(0, 16)}`,
    `  READER SEES: ${item.title}`,
    `  story: ${item.news} news, ${item.media} media, first ${item.firstAge} d ago, last ${item.lastAge} d ago, ${item.inLastDay} in the last 24 h${item.thread ? `; thread ${item.thread.stories} stories ${item.thread.news} news first ${item.thread.firstAge} d ago` : ''}`,
    ...item.first.map(row => `  FIRST   ${String(row.age).padStart(5)} d  ${row.medium} [${row.lang}] ${row.title}`),
    ...item.lastDay.map(row => `  LAST24H ${String(row.age).padStart(5)} d  ${row.medium} [${row.lang}] ${row.title}`),
].join('\n')).join('\n\n');
writeFileSync(`bench/data/old-news-pack${suffix}.txt`, text);
console.log(`${pack.length} stories drawn of ${pool.length} (${old.length} cards older than their window + 12 h)`);
