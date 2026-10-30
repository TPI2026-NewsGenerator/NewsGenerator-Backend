// The links of the database now against truth.json (see build.mjs), the most seen row of each name: right
// (the judged item, or no link where none is right), country (the country of a body), wrong (a judged
// wrong item, or another than the one judged right), pending (not looked for again yet), lost (no link where one is right), other (an item
// nobody judged). Lists the wrong and lost ones. node --env-file=.env bench/link-truth/score.mjs
import fs from 'node:fs';
import pg from 'pg';

const truth = JSON.parse(fs.readFileSync(new URL('./truth.json', import.meta.url), 'utf8'));
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const {rows} = await db.query(`SELECT DISTINCT ON (kind, key) kind, key, name, qid, seen, linked_at FROM mentions
    WHERE (kind, key) IN (SELECT * FROM unnest($1::text[], $2::text[])) ORDER BY kind, key, seen DESC`,
    [truth.map(e => e.kind), truth.map(e => e.key)]);
await db.end();
const now = new Map(rows.map(row => [`${row.kind}|${row.key}`, row]));

const verdictOf = (e, qid, row) => {
    if (!qid && !row.linked_at) return 'pending';
    if (qid && e.right.includes(qid)) return 'right';
    if (qid && e.country.includes(qid)) return 'country';
    if (qid && e.wrong.includes(qid)) return 'wrong';
    if (!qid) return e.right.length > 0 ? 'lost' : 'right';
    return e.right.length > 0 || e.none ? 'wrong' : 'other';
};
const tally = {};
const bad = [];
for (const e of truth) {
    const row = now.get(`${e.kind}|${e.key}`);
    if (!row) continue;
    const verdict = verdictOf(e, row.qid, row);
    for (const suite of [...e.suites, 'all']) {
        tally[suite] ??= {};
        tally[suite][verdict] = (tally[suite][verdict] ?? 0) + 1;
    }
    if (verdict === 'wrong' || verdict === 'lost') bad.push(`${verdict}\t${e.kind}\t${row.name}\tnow ${row.qid}\tright ${e.right.join('/') || '-'}\tseen ${row.seen}`);
}
console.table(tally);
console.log(bad.sort().join('\n'));
