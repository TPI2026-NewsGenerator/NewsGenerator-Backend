//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: late-news.mjs
//  Description: News that reach the reader late (the user, 12.11.2026: "une nouvelle sortie il y a une semaine reprise par un autre journal une semaine après ... notre
//               système ne peut pas savoir ça ?"). The age gate (old-news.js) judges a story only when its OWN story holds news from before the window; a news told late
//               after more than 48 h of silence starts a new story (the grouping joins a news to the stories of the last 48 h) with no earlier news of its own. The benches
//               of the gate drew their cards among the ones whose first news was older than the window, so this case was never measured. Here: cards really delivered
//               (the saved briefings since 10.11.2026), and for each the earlier coverage three ways: its own story, its affair (thread), the stories close by their
//               centroid in the 14 days before the window (a scan: 9.5 s a card, so only a sample). Judged blind: is the fact of the card already told by that coverage?
//
//  node --env-file=.env bench/late-news.mjs build [cards=60]     the sample and its evidence: bench/data/late-news/pack.json, judge-*.md
//  node --env-file=.env bench/late-news.mjs score                reads verdicts-L-*.json
//

import process from 'node:process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import pg from 'pg';

const DIR = 'bench/data/late-news';
const DAY = 86400e3;
const GRACE_HOURS = 12;
const SINCE = '2026-11-10T06:00:00Z';
const norm = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const NL = String.fromCharCode(10);

const build = async (count = 60) => {
    const dataset = JSON.parse(readFileSync('bench/data/dup-eval/dataset.json', 'utf8')).filter(briefing => briefing.at >= SINCE);
    // the cards of these briefings, once per story, the ones that repeat a card sent apart (they are judged elsewhere)
    const seen = new Set();
    const pool = dataset.flatMap(briefing => briefing.cards.map(card => ({briefing, card})))
        .filter(({card}) => card.storyId > 0 && !card.imported && !seen.has(card.storyId) && seen.add(card.storyId));
    let seed = 20261112;
    const random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const sample = pool.map(row => [random(), row]).sort((x, y) => x[0] - y[0]).slice(0, count).map(([, row]) => row);

    const c = new pg.Client({connectionString: process.env.DATABASE_URL, statement_timeout: 90000});
    await c.connect();
    const pack = [];
    for (const [i, {briefing, card}] of sample.entries()) {
        const written = new Date(briefing.at);
        const cutoff = new Date(written - (briefing.hours + GRACE_HOURS) * 3600e3);
        const ids = [card.storyId, ...card.merged].filter(id => id > 0);
        const age = (at) => Math.round((written - new Date(at)) / DAY * 10) / 10;
        const onePerMedium = (rows, n) => { const m = new Set(); return rows.filter(row => !m.has(row.medium ?? row.title) && m.add(row.medium ?? row.title)).slice(0, n); };
        const asRow = (row, extra = {}) => ({age: age(row.at), medium: row.medium, title: norm(row.title), ...extra});
        const t0 = Date.now();
        // 1. its own story (and the stories joined to it)
        const own = (await c.query(`SELECT COALESCE(a.published_at, a.created_at) AS at, a.medium, left(a.title, 150) AS title FROM articles a
            WHERE a.id_story = ANY($1::int[]) AND COALESCE(a.published_at, a.created_at) < $2::timestamptz ORDER BY 1`, [ids, cutoff])).rows;
        // 2. its affair: the news of the stories of its thread before the window, the closest to its centroid first
        const {rows: [story]} = await c.query('SELECT id_thread FROM stories WHERE id = $1', [card.storyId]);
        const thread = story?.id_thread ? (await c.query(`SELECT COALESCE(a.published_at, a.created_at) AS at, a.medium, left(a.title, 150) AS title, 1 - (a.text_dense <=> s0.centroid) AS sim
            FROM stories s0 JOIN stories s ON s.id_thread = s0.id_thread JOIN articles a ON a.id_story = s.id
            WHERE s0.id = $1 AND s0.centroid IS NOT NULL AND a.text_dense IS NOT NULL AND NOT (a.id_story = ANY($3::int[])) AND COALESCE(a.published_at, a.created_at) < $2::timestamptz
            ORDER BY a.text_dense <=> s0.centroid LIMIT 60`, [card.storyId, cutoff, ids])).rows : [];
        // 3. the stories close by their centroid, updated in the 14 days before the window (not its own, not its affair's ... the scan does not know them)
        const near = (await c.query(`SELECT o.id, -(o.centroid <#> s.centroid)::real AS likeness FROM stories s, stories o
            WHERE s.id = $1 AND s.centroid IS NOT NULL AND o.centroid IS NOT NULL AND NOT (o.id = ANY($3::int[]))
              AND o.updated_at >= $2::timestamptz - interval '14 days' AND o.updated_at < $2::timestamptz
            ORDER BY o.centroid <#> s.centroid LIMIT 6`, [card.storyId, cutoff, ids])).rows;
        const vector = [];
        for (const row of near) {
            const {rows: [first]} = await c.query(`SELECT COALESCE(published_at, created_at) AS at, medium, left(title, 150) AS title FROM articles WHERE id_story = $1 ORDER BY 1 LIMIT 1`, [row.id]);
            if (first) vector.push(asRow(first, {likeness: Math.round(row.likeness * 100) / 100, story: row.id}));
        }
        const inThread = new Set(thread.map(row => row.title));
        pack.push({n: i + 1, briefing: briefing.id, profile: briefing.profile, written, hours: briefing.hours, storyId: card.storyId, title: card.title, publishedAt: card.publishedAt, media: card.media,
            text: card.text.split(/\s+/).slice(0, 70).join(' '),
            own: onePerMedium(own, 5).map(row => asRow(row)), ownCount: own.length,
            thread: onePerMedium(thread, 5).map(row => asRow(row, {sim: Math.round(row.sim * 100) / 100})), threadCount: thread.length,
            vector: vector.filter(row => !inThread.has(row.title)).slice(0, 5)});
        console.log(`card ${i + 1}/${sample.length} story ${card.storyId}: own ${own.length}, thread ${thread.length}, vector ${vector.length} (${Math.round((Date.now() - t0) / 1000)} s)`);
    }
    await c.end();
    mkdirSync(DIR, {recursive: true});
    writeFileSync(`${DIR}/pack.json`, JSON.stringify(pack));
    const lines = (label, rows) => rows.length === 0 ? [`  ${label}: none`] : [`  ${label}:`, ...rows.map(row => `    - ${row.age} days before the briefing | ${row.medium ?? '?'} | ${row.title}${row.likeness ? ` (likeness ${row.likeness})` : ''}${row.sim ? ` (likeness ${row.sim})` : ''}`)];
    const parts = pack.map(item => [`## Card ${item.n}`, '', `The reader's briefing was written ${item.written.toISOString().slice(0, 16).replace('T', ' ')} (news of the last ${item.hours} h). The card:`,
        `  TITLE: ${item.title}`, `  TEXT: ${item.text}`, '', 'Earlier coverage found, news published BEFORE the window of the briefing:',
        ...lines('A. in its own story', item.own), ...lines('B. in its affair (thread)', item.thread), ...lines('C. closest stories of the 14 days before', item.vector), ''].join(NL));
    for (let i = 0; i < parts.length; i += 30) writeFileSync(`${DIR}/judge-${String(i / 30 + 1).padStart(2, '0')}.md`, parts.slice(i, i + 30).join(NL));
    console.log(`${pack.length} cards, ${Math.ceil(parts.length / 30)} judge files`);
};

const score = () => {
    const pack = JSON.parse(readFileSync(`${DIR}/pack.json`, 'utf8'));
    const verdicts = new Map();
    for (let slice = 1; slice <= 10; slice++) {
        const file = `${DIR}/verdicts-L-${String(slice).padStart(2, '0')}.json`;
        if (existsSync(file)) for (const [n, value] of Object.entries(JSON.parse(readFileSync(file, 'utf8')))) verdicts.set(Number(n), value);
    }
    const count = {};
    const bySource = {own: 0, thread: 0, vector: 0, none: 0};
    const old = pack.filter(item => verdicts.get(item.n)?.verdict === 'OLD');
    for (const item of pack) { const v = verdicts.get(item.n)?.verdict ?? 'NOT JUDGED'; count[v] = (count[v] ?? 0) + 1; }
    console.log(`${pack.length} delivered cards: ${JSON.stringify(count)}`);
    const sees = (item, source) => (verdicts.get(item.n)?.sources ?? []).includes(source);
    for (const item of old) {
        const found = ['own', 'thread', 'vector'].filter(source => sees(item, source));
        for (const source of found) bySource[source]++;
        if (found.length === 0) bySource.none++;
        console.log(`  OLD card ${item.n} "${item.title.slice(0, 70)}" found by: ${found.join(', ') || '?'} | ${verdicts.get(item.n)?.fact ?? ''}`);
    }
    console.log(`the old ones found by their own story ${bySource.own}, by their affair ${bySource.thread}, by the close stories ${bySource.vector} of ${old.length}; own story empty for ${old.filter(item => item.own.length === 0).length}`);
};

// ---- the age gate of the briefing (old-news.js, the real prompt and model) run on the same cards with the earlier coverage taken from each place: what it flags of the cards
// judged OLD, and what it flags of the cards judged NEW (the news it would hide)
const ask = async () => {
    const {oldStories, EARLIER, GRACE_HOURS: grace} = await import('../services/utils/old-news.js');
    const {StoryModel} = await import('../models/story-model.js');
    const {newUsage} = await import('../services/utils/ollama.js');
    const {prisma} = await import('../config/db.js');
    const pack = JSON.parse(readFileSync(`${DIR}/pack.json`, 'utf8'));
    const verdicts = new Map();
    for (let slice = 1; slice <= 10; slice++) {
        const file = `${DIR}/verdicts-L-${String(slice).padStart(2, '0')}.json`;
        if (existsSync(file)) for (const [n, value] of Object.entries(JSON.parse(readFileSync(file, 'utf8')))) verdicts.set(Number(n), value.verdict);
    }
    const asRows = (item, rows) => rows.map(row => ({at: new Date(new Date(item.written) - row.age * DAY), title: row.title, medium: row.medium}));
    const cards = [];
    for (const item of pack) {
        const written = new Date(item.written);
        const before = new Date(written - (item.hours + grace) * 3600e3);
        // the real earlier news of its own story, as the briefing reads them (the closest to the story first)
        const own = (await StoryModel.earlierNews({storyIds: [item.storyId], before, perStory: EARLIER})).map(row => ({at: row.at, title: row.title, medium: row.medium}));
        const within = (await prisma.$queryRawUnsafe(`SELECT DISTINCT ON (a.medium) COALESCE(a.published_at, a.created_at) AS at, a.title, a.medium FROM articles a WHERE a.id_story = $1
            AND COALESCE(a.published_at, a.created_at) >= $2::timestamptz AND COALESCE(a.published_at, a.created_at) <= $3::timestamptz ORDER BY a.medium, 1 DESC`,
            item.storyId, new Date(written - item.hours * 3600e3), written)).map(row => ({at: row.at, title: norm(row.title), medium: row.medium})).slice(-8);
        cards.push({item, own, thread: asRows(item, item.thread), vector: asRows(item, item.vector), within, verdict: verdicts.get(item.n)});
    }
    const uniq = (rows) => { const seen = new Set(); return rows.filter(row => !seen.has(row.title) && seen.add(row.title)).slice(0, EARLIER); };
    const variants = {
        'own (what is built)': card => card.own,
        'own, else its affair': card => card.own.length > 0 ? card.own : card.thread,
        'own + its affair': card => uniq([...card.own, ...card.thread]),
        'own, else the close stories': card => card.own.length > 0 ? card.own : card.vector,
        'own + affair + close stories': card => uniq([...card.own, ...card.thread, ...card.vector]),
        'the close stories alone': card => card.vector,
    };
    const usage = newUsage();
    console.log(`${cards.length} cards: ${['OLD', 'NEW', 'UNSURE'].map(v => `${v} ${cards.filter(card => card.verdict === v).length}`).join(', ')}`);
    for (const [name, pick] of Object.entries(variants)) {
        const flagged = new Set();
        let asked = 0;
        for (const group of Object.values(Object.groupBy(cards, card => card.item.briefing))) {
            const stories = group.flatMap(card => {
                const earlier = pick(card);
                return earlier.length > 0 && card.within.length > 0 ? [{id: String(card.item.n), title: card.item.title, earlier, within: card.within}] : [];
            });
            asked += stories.length;
            if (stories.length === 0) continue;
            for (const id of (await oldStories(stories, group[0].item.hours, {usage, now: new Date(group[0].item.written).getTime()})).keys()) flagged.add(Number(id));
        }
        const of = (v) => cards.filter(card => card.verdict === v);
        console.log(`${name.padEnd(30)} asked ${String(asked).padStart(2)}: flags ${of('OLD').filter(card => flagged.has(card.item.n)).length} of ${of('OLD').length} old, ${of('NEW').filter(card => flagged.has(card.item.n)).length} of ${of('NEW').length} new, ${of('UNSURE').filter(card => flagged.has(card.item.n)).length} of ${of('UNSURE').length} unsure`);
    }
    console.log(`tokens ${JSON.stringify(usage)}`);
    await prisma.$disconnect();
};

const [command, argument] = process.argv.slice(2);
if (command === 'ask') await ask();
else if (command === 'build') await build(argument ? Number(argument) : 60);
else if (command === 'score') score();
else console.error('build [cards] | score');
process.exit(0);
