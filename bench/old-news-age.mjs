// How old are the news of the saved briefings when they are shown (the user, 10.11.2026, friend's point 6: "a news already known for a week comes
// back every day, because some media take a week to write on it"). For each card of the last saved briefings: when its story was first told, the
// last time, how many news came in the last 24 h before the briefing, and the same for its thread (the affair); the ages and the cards whose
// first news is older than N days are printed, with the titles of the first and last news. Writes bench/data/old-news-age.json
//   node --env-file=.env bench/old-news-age.mjs [briefings=14]
import process from 'node:process';
import {mkdirSync, writeFileSync} from 'node:fs';
import pg from 'pg';

const count = Number(process.argv[2] ?? 14);
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const DAY = 86400e3;

const {rows: briefings} = await c.query(`SELECT id, id_profile, hours, created_at, items FROM briefings WHERE status = 'ready' AND created_at > now() - interval '9 days'
    ORDER BY id DESC LIMIT $1`, [count]);
const cards = [];
for (const briefing of briefings) {
    const written = new Date(briefing.created_at);
    for (const [position, card] of (Array.isArray(briefing.items) ? briefing.items : []).entries()) {
        if (!Number.isInteger(card.storyId) || card.storyId <= 0) continue;
        const ids = [card.storyId, ...(Array.isArray(card.mergedStoryIds) ? card.mergedStoryIds.filter(Number.isInteger) : [])];
        const {rows: [story]} = await c.query(`SELECT id_thread FROM stories WHERE id = $1`, [card.storyId]);
        // only the news there were when the briefing was written: the story went on after it
        const {rows: news} = await c.query(`SELECT id_story, COALESCE(published_at, created_at) at, medium, lang, left(title, 150) title FROM articles
            WHERE id_story = ANY($1) AND COALESCE(published_at, created_at) <= $2 ORDER BY 2`, [ids, written]);
        if (news.length === 0) continue;
        let thread = null;
        if (story?.id_thread) {
            const {rows} = await c.query(`SELECT a.id_story, COALESCE(a.published_at, a.created_at) at, a.medium, left(a.title, 150) title
                FROM articles a JOIN stories s ON s.id = a.id_story WHERE s.id_thread = $1 AND COALESCE(a.published_at, a.created_at) <= $2 ORDER BY 2`, [story.id_thread, written]);
            thread = rows;
        }
        const ago = (row) => (written - new Date(row.at)) / DAY;
        cards.push({
            briefing: briefing.id, profile: briefing.id_profile, hours: briefing.hours, written, position: position + 1, storyId: card.storyId,
            title: card.title, shownAs: card.followUp ? 'followUp' : 'new',
            news: news.length, media: new Set(news.map(row => row.medium)).size,
            firstAge: ago(news[0]), lastAge: ago(news.at(-1)),
            inLastDay: news.filter(row => ago(row) <= 1).length,
            inWindow: news.filter(row => ago(row) <= briefing.hours / 24).length,
            threadNews: thread?.length ?? 0, threadFirstAge: thread ? ago(thread[0]) : null,
            threadStories: thread ? new Set(thread.map(row => row.id_story)).size : 0,
            first: news[0].title, last: news.at(-1).title,
            threadFirst: thread?.[0]?.title ?? null,
        });
    }
}
await c.end();
mkdirSync('bench/data', {recursive: true});
writeFileSync('bench/data/old-news-age.json', JSON.stringify(cards, null, 1));

const bucket = (age) => age < 1 ? '<1d' : age < 2 ? '1-2d' : age < 3 ? '2-3d' : age < 4 ? '3-4d' : age < 5 ? '4-5d' : age < 7 ? '5-7d' : '>7d';
const tally = (key) => {
    const counts = new Map();
    for (const card of cards) {
        const age = card[key];
        if (age === null) continue;
        counts.set(bucket(age), (counts.get(bucket(age)) ?? 0) + 1);
    }
    return ['<1d', '1-2d', '2-3d', '3-4d', '4-5d', '5-7d', '>7d'].map(name => `${name}: ${counts.get(name) ?? 0}`).join('  ');
};
console.log(`${cards.length} cards of ${briefings.length} briefings (hours: ${[...new Set(briefings.map(b => b.hours))].join(', ')})`);
console.log('first news of the story:   ', tally('firstAge'));
console.log('first news of its thread:  ', tally('threadFirstAge'), ` (${cards.filter(card => card.threadFirstAge === null).length} cards in no thread)`);
console.log(`news of the story in the last 24 h: median ${[...cards].map(card => card.inLastDay).sort((a, b) => a - b)[Math.floor(cards.length / 2)]}, none in the last 24 h: ${cards.filter(card => card.inLastDay === 0).length}`);
