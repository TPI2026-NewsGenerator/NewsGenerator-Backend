// The earlier coverage of the age gate taken from the whole AFFAIR (thread) of a story, the news the closest to it by meaning, instead of the first news of its own
// story only (the user, 10.11.2026: "étendre le filtre des vieilles news à l'affaire entière"). On the 66 stories rated by hand (bench/data/old-news-labels*.json:
// S stale, F fresh, U unsure): what each way of choosing the earlier coverage catches of the stale ones, and what it loses of the fresh ones.
//   node --env-file=.env bench/old-news-thread.mjs build        the earlier news of each story, own and from its thread with their similarity -> bench/data/old-news-thread.json
//   node --env-file=.env bench/old-news-thread.mjs run <variant> [runs=3]
// variants: story (the first 5 of its own story: what is built), ownsim (the 5 of its own story the closest by meaning), ownsim_else_thread, top (the 5 closest of the affair), floor60 / floor70 (the closest with a similarity of 0.60 /
// 0.70 at least), story+floor (its own, then the closest of the affair at 0.65 or more to make 5), ownlast (the closest of the affair, its own only when it has no
// other)
import fs from 'node:fs';
import process from 'node:process';
import pg from 'pg';
import {oldStories} from '../services/utils/old-news.js';

const mode = process.argv[2];
const DAY = 86400e3;
const sets = [
    {pack: 'bench/data/old-news-pack.json', labels: 'bench/data/old-news-labels.json', offset: 0},
    {pack: 'bench/data/old-news-pack2.json', labels: 'bench/data/old-news-labels2.json', offset: 100},
];
const OUT = 'bench/data/old-news-thread.json';

if (mode === 'build') {
    const c = new pg.Client({connectionString: process.env.DATABASE_URL});
    await c.connect();
    const stories = [];
    for (const {pack, labels, offset} of sets) {
        const items = JSON.parse(fs.readFileSync(pack, 'utf8'));
        const rated = JSON.parse(fs.readFileSync(labels, 'utf8')).labels;
        for (const item of items) {
            const written = new Date(item.written);
            const cutoffAge = item.hours / 24 + 0.5;
            const cutoff = new Date(written - cutoffAge * DAY);
            const {rows: [story]} = await c.query('SELECT id_thread FROM stories WHERE id = $1', [item.storyId]);
            // the news of the affair before the cutoff, the closest to the story first (cosine of the vector of their text to the centroid of the story)
            const {rows} = story?.id_thread ? await c.query(`
                SELECT a.id_story, COALESCE(a.published_at, a.created_at) AS at, a.medium, left(a.title, 160) AS title,
                       1 - (a.text_dense <=> s0.centroid) AS sim
                FROM stories s0 JOIN stories s ON s.id_thread = s0.id_thread JOIN articles a ON a.id_story = s.id
                WHERE s0.id = $1 AND a.text_dense IS NOT NULL AND s0.centroid IS NOT NULL AND COALESCE(a.published_at, a.created_at) < $2
                ORDER BY a.text_dense <=> s0.centroid LIMIT 80`, [item.storyId, cutoff]) : {rows: []};
            const seen = new Set();
            const thread = rows.filter(row => !seen.has(row.medium ?? `#${row.title}`) && seen.add(row.medium ?? `#${row.title}`)).slice(0, 15)
                .map(row => ({age: (written - new Date(row.at)) / DAY, medium: row.medium, title: row.title, sim: Number(row.sim), own: row.id_story === item.storyId}));
            stories.push({id: offset + item.n, label: rated[item.n], hours: item.hours, title: item.title, within: item.within,
                own: item.before.filter(row => row.age > cutoffAge), thread, threadId: story?.id_thread ?? null});
        }
    }
    await c.end();
    fs.writeFileSync(OUT, JSON.stringify(stories, null, 1));
    const rated = stories.filter(story => story.label === 'S' || story.label === 'F');
    console.log(`${stories.length} stories (${rated.length} rated S or F), ${stories.filter(story => story.thread.length > 0).length} with earlier news in their affair, ${stories.filter(story => story.own.length > 0).length} with earlier news of their own`);
    process.exit(0);
}

const variant = mode === 'run' ? process.argv[3] : null;
const runs = Number(process.argv[4] ?? 3);
const stories = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const first = (list, n = 5) => list.slice(0, n);
const earlierOf = {
    story: (story) => first(story.own),
    top: (story) => first(story.thread),
    // its own story only, the closest to it first instead of the first in time
    ownsim: (story) => first(story.thread.filter(row => row.own)),
    // its own story by meaning, its affair only for a story with no news of its own before
    ownsim_else_thread: (story) => {
        const own = first(story.thread.filter(row => row.own));
        return own.length > 0 ? own : first(story.thread);
    },
    floor60: (story) => first(story.thread.filter(row => row.sim >= 0.60)),
    floor70: (story) => first(story.thread.filter(row => row.sim >= 0.70)),
    'story+floor': (story) => {
        const own = first(story.own);
        return [...own, ...story.thread.filter(row => row.sim >= 0.65 && !own.some(other => other.title === row.title))].slice(0, 5);
    },
    ownlast: (story) => {
        const close = first(story.thread.filter(row => row.sim >= 0.65));
        return close.length > 0 ? close : first(story.own);
    },
}[variant];
if (!earlierOf) throw new Error(`variant ${variant}`);

// every age is given against one reference time: the prompt shows "3.3 days ago"
const NOW = Date.now();
const rows = (list) => list.map((row, i) => ({at: new Date(NOW - row.age * DAY), title: row.title, medium: row.medium ?? `m${i}.example`}));
const asked = stories.map(story => ({story, earlier: earlierOf(story)})).filter(({earlier}) => earlier.length > 0);
const dropped = new Map();
for (let run = 0; run < runs; run++) {
    for (const hours of [...new Set(asked.map(({story}) => story.hours))]) {
        const group = asked.filter(({story}) => story.hours === hours);
        const old = await oldStories(group.map(({story, earlier}) => ({id: String(story.id), title: story.title, earlier: rows(earlier), within: rows(story.within)})), hours, {now: NOW});
        for (const id of old.keys()) dropped.set(Number(id), (dropped.get(Number(id)) ?? 0) + 1);
    }
}
const drops = (story) => (dropped.get(story.id) ?? 0) * 2 > runs;
const stale = stories.filter(story => story.label === 'S');
const fresh = stories.filter(story => story.label === 'F');
const caught = stale.filter(drops);
const lost = fresh.filter(drops);
const pct = (a, b) => b === 0 ? '-' : `${Math.round(100 * a / b)}%`;
console.log(`${variant} x${runs}: asked ${asked.length} of ${stories.length}; stale caught ${caught.length}/${stale.length} (${pct(caught.length, stale.length)}), fresh lost ${lost.length}/${fresh.length} (${pct(lost.length, fresh.length)}), precision of the drops ${pct(caught.length, caught.length + lost.length)}`);
console.log('  stale not caught:', stale.filter(story => !drops(story)).map(story => story.id).join(' '));
console.log('  fresh lost:      ', lost.map(story => story.id).join(' '));
console.log('  unsure dropped:  ', stories.filter(story => story.label === 'U' && drops(story)).map(story => story.id).join(' '));
fs.writeFileSync(`bench/data/old-news-thread-run-${variant.replace(/\W/g, '_')}.json`, JSON.stringify(stories.map(story => ({id: story.id, label: story.label, asked: asked.some(row => row.story === story), dropped: drops(story)})), null, 1));
