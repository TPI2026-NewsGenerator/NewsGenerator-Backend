// Read only: "Other angles" of a card measured before building it. For each card of the briefings of
// some profiles, the other stories of the same affair a card could list below it:
//   A. the other stories of its thread (db/add_threads.sql, same language), newest first,
//   B. the stories of any language whose centroid is close to the card's (cosine >= MIN_LIKENESS),
//      outside its thread: what a cross-language version would add.
// Each story given with the title of its newest news and its media, to be judged by hand. Nothing is
// written in the database. Result: bench/data/other-angles.txt
//   node --env-file=.env bench/other-angles.mjs [profileIds=7,8] [days=3]
import process from 'node:process';
import fs from 'node:fs';
import pg from 'pg';

const profileIds = (process.argv[2] ?? '7,8').split(',').map(Number);
const DAYS = Number(process.argv[3] ?? 3);
const PER_CARD = 4;
const MIN_LIKENESS = 0.6;
const BEFORE = '3 days', AFTER = '6 hours';   // around the briefing: what the reader could be shown then

const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
const {rows: briefings} = await pool.query(`SELECT id, id_profile, created_at, items FROM briefings
    WHERE id_profile = ANY($1) AND status = 'ready' AND created_at > now() - make_interval(days => $2)
    ORDER BY created_at DESC`, [profileIds, DAYS]);

const cards = [];
const seen = new Set();
for (const briefing of briefings) {
    for (const item of briefing.items ?? []) {
        if (!item.storyId || seen.has(`${briefing.id_profile}:${item.storyId}`)) continue;
        seen.add(`${briefing.id_profile}:${item.storyId}`);
        cards.push({profile: briefing.id_profile, at: briefing.created_at, storyId: item.storyId, title: item.title,
            links: new Set((item.articles ?? []).map(article => article.url))});
    }
}

// the newest news of a story and its media
const STORY = `(SELECT a.title FROM articles a WHERE a.id_story = s2.id ORDER BY a.published_at DESC NULLS LAST LIMIT 1) AS title,
    (SELECT array_agg(a.link) FROM articles a WHERE a.id_story = s2.id) AS links,
    s2.lang, cardinality(s2.media) AS media, round((-(s2.centroid <#> s.centroid))::numeric, 3) AS likeness`;

const lines = [];
let withA = 0, withB = 0, totalA = 0, totalB = 0;
for (const card of cards) {
    const {rows: [story]} = await pool.query('SELECT id, id_thread, lang, cardinality(media) AS media FROM stories WHERE id = $1', [card.storyId]);
    if (!story) continue;
    const window = [card.at, BEFORE, AFTER];
    const {rows: thread} = story.id_thread === null ? {rows: []} : await pool.query(`
        SELECT s2.id, ${STORY} FROM stories s, stories s2
        WHERE s.id = $1 AND s2.id_thread = s.id_thread AND s2.id <> s.id
          AND s2.updated_at BETWEEN $2::timestamptz - $3::interval AND $2::timestamptz + $4::interval
        ORDER BY s2.updated_at DESC LIMIT ${PER_CARD * 2}`, [card.storyId, ...window]);
    const {rows: near} = await pool.query(`
        SELECT s2.id, ${STORY} FROM stories s, stories s2
        WHERE s.id = $1 AND s2.id <> s.id AND s2.id_thread IS DISTINCT FROM s.id_thread
          AND s2.updated_at BETWEEN $2::timestamptz - $3::interval AND $2::timestamptz + $4::interval
          AND -(s2.centroid <#> s.centroid) >= ${MIN_LIKENESS}
        ORDER BY s2.centroid <#> s.centroid LIMIT ${PER_CARD * 2}`, [card.storyId, ...window]);
    // a story whose news are already on the card is no other angle: it joined the card
    const apart = (list) => list.filter(row => !(row.links ?? []).some(link => card.links.has(link))).slice(0, PER_CARD);
    const a = apart(thread), b = apart(near);
    if (a.length) withA++;
    if (b.length) withB++;
    totalA += a.length;
    totalB += b.length;
    lines.push(`\n#${card.storyId} [p${card.profile} ${story.lang} ${story.media} media, thread ${story.id_thread ?? '-'}] ${card.title}`);
    for (const row of a) lines.push(`  A ${row.likeness} ${row.lang} ${row.media}m #${row.id} ${row.title}`);
    for (const row of b) lines.push(`  B ${row.likeness} ${row.lang} ${row.media}m #${row.id} ${row.title}`);
}
const head = `profiles ${profileIds} ${DAYS} d: ${cards.length} cards; A (thread) on ${withA} cards, ${totalA} stories; B (close, any language) on ${withB} cards, ${totalB} stories`;
fs.mkdirSync(new URL('./data/', import.meta.url), {recursive: true});
fs.writeFileSync(new URL('./data/other-angles.txt', import.meta.url), head + '\n' + lines.join('\n') + '\n');
console.log(head);
await pool.end();
