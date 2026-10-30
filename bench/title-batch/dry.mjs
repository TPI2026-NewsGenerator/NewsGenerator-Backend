// The title pre-pass (title-links.js) on names that wait in the queue: 150 persons in full and 150 places at
// random (seen 3 times or more), what it would link and the item, to judge by hand. Writes nothing.
// node --env-file=.env bench/title-batch/dry.mjs [per kind, 150]
import pg from 'pg';
import {linkedByTitle} from '../../services/utils/title-links.js';
import {describeItems} from '../../services/utils/wikidata.js';
import {prisma} from '../../config/db.js';

const PER_KIND = Number(process.argv[2] ?? 150);
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const rows = [];
for (const [kind, extra] of [['person', "AND key LIKE '% %'"], ['location', '']]) {
    rows.push(...(await db.query(`SELECT id, name, kind, lang, seen FROM mentions WHERE kind = $1 AND linked_at IS NULL AND seen >= 3 ${extra} ORDER BY random() LIMIT $2`, [kind, PER_KIND])).rows);
}
await db.end();
const started = Date.now();
const linked = await linkedByTitle(rows);
console.log(`${rows.length} names, ${linked.size} linked by title in ${Math.round((Date.now() - started) / 1000)} s`);
for (const kind of ['person', 'location']) console.log(`${kind}: ${[...linked.keys()].filter(id => rows.find(r => r.id === id).kind === kind).length} of ${rows.filter(r => r.kind === kind).length}`);
const items = new Map();
const qids = [...new Set(linked.values())];
for (let i = 0; i < qids.length; i += 50) for (const item of await describeItems(qids.slice(i, i + 50), {batch: 50})) items.set(item.qid, item);
for (const [id, qid] of linked) {
    const row = rows.find(r => r.id === id);
    console.log(`${row.kind[0]} ${row.name} [${row.lang}] seen ${row.seen} -> ${qid} ${items.get(qid)?.label} (${(items.get(qid)?.description ?? '').slice(0, 50)}) ${items.get(qid)?.links}w`);
}
await prisma.$disconnect();
