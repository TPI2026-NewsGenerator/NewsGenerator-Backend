//
//  Author: Fabian Rostello
//  Date: 11.11.2026
//  File: measure.mjs
//  Description: The search by keywords with the accents in classes of letters takes 30 to 60 s on a week of every feed (defect 1 of the 11.11.2026
//               audit, see the decision log). Measures the way out on a copy of the last days of the database in a TEMPORARY table of this session
//               (nothing is written for good): the same keywords asked with the accents in classes (index of search_text, as today) and with the
//               accents folded by Postgres on both sides (index of plain_text(search_text), the migration db/add_plain_search.sql): the plan, the
//               time, the news found, and the time to build the index (the migration on the whole table is about that time times the size).
//
//               node bench/plain-search/measure.mjs [days of news copied, 3]
//

import 'dotenv/config';
import pg from 'pg';
import {Filter} from '../../services/utils/filter.js';

const DAYS = Number(process.argv[2] ?? 3);
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const time = async (label, sql, params = []) => {
    const started = Date.now();
    const result = await client.query(sql, params);
    console.log(`${label}: ${((Date.now() - started) / 1000).toFixed(1)} s`);
    return result;
};

await client.query(`SET statement_timeout = '600s'`);
await time(`copy of ${DAYS} days`, `CREATE TEMP TABLE sample AS SELECT id, search_text FROM articles WHERE created_at >= now() - interval '${DAYS} days'`);
const {rows: [{n}]} = await client.query('SELECT count(*)::int AS n FROM sample');
console.log(`${n} news copied`);
await client.query(`CREATE FUNCTION pg_temp.plain_text(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
    AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$`);
await time('index of search_text (as today)', `CREATE INDEX sample_raw ON sample USING gin (search_text gin_trgm_ops)`);
await time('index of plain_text(search_text) (the migration)', `CREATE INDEX sample_plain ON sample USING gin (pg_temp.plain_text(search_text) gin_trgm_ops)`);
await client.query('ANALYZE sample');
const size = async (name) => (await client.query(`SELECT pg_size_pretty(pg_relation_size('${name}')) AS size`)).rows[0].size;
console.log(`sizes: raw ${await size('sample_raw')}, plain ${await size('sample_plain')}`);

const KEYWORDS = ['infantino', 'Zürich', 'zurich', 'Negreira', 'désignations', 'Barça', '"red card"', 'VAR', 'var', 'ai', 'UEFA', 'Mbappé', 'ñ',
    'Ødegaard', 'Łódź', 'Düsseldorf', 'sao paulo', 'referee -rugby', 'Fabrizio Romano, Gianni Infantino', 'arbitre arbitros arbitri'];
const rows = [];
for (const keywords of KEYWORDS) {
    const parsed = Filter.parse([keywords]);
    const run = async (fold) => {
        const sql = Filter.keywordsSql(parsed, 1, 'search_text', {fold});
        const explain = (await client.query(`EXPLAIN (ANALYZE, TIMING OFF) SELECT id FROM sample WHERE ${sql.sql}`, sql.params)).rows.map(row => row['QUERY PLAN']);
        const found = (await client.query(`SELECT id FROM sample WHERE ${sql.sql}`, sql.params)).rows.map(row => row.id);
        return {
            ms: Number(/Execution Time: ([\d.]+) ms/.exec(explain.join('\n'))[1]),
            index: /Bitmap Index Scan on (\w+)/.exec(explain.join('\n'))?.[1] ?? 'seq scan',
            found: new Set(found),
        };
    };
    const classes = await run(null);
    const plain = await run('pg_temp.plain_text');
    const lost = [...classes.found].filter(id => !plain.found.has(id)).length;
    rows.push({keywords, 'classes ms': Math.round(classes.ms), 'classes plan': classes.index, 'plain ms': Math.round(plain.ms), 'plain plan': plain.index,
        'news classes': classes.found.size, 'news plain': plain.found.size, 'lost by plain': lost});
}
console.table(rows);
await client.end();
