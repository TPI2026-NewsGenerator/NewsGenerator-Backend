//
//  Author: Fabian Rostello
//  Date: 11.11.2026
//  File: scale.mjs
//  Description: The search by keywords at the size of the real table (4.6 million news, a week of every feed): the pattern with the accents in
//               classes of letters (what the interface asks today) against the same pattern with the letters as they are, on the index of
//               search_text that exists (what the folded index would be asked: the same trigrams; it lacks the accents folded of the news
//               found and the time to fold the texts it reads again). To choose from how many letters a term is folded (MIN_FOLDED of filter.js).
//               Read-only, one query at a time, 120 s at most each.
//
//               node bench/plain-search/scale.mjs [days, 7] term term...
//

import 'dotenv/config';
import pg from 'pg';
import {Filter} from '../../services/utils/filter.js';

const [daysArg, ...rest] = process.argv.slice(2);
const DAYS = Number(daysArg ?? 7);
const TERMS = rest.length > 0 ? rest : ['infantino', 'zurich', 'mbappé', 'uefa', 'arbitre', 'var', 'sao paulo'];
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
await client.query(`SET statement_timeout = '120s'`);
const {rows: feeds} = await client.query('SELECT url FROM feeds');
const since = new Date(Date.now() - DAYS * 864e5);

const run = async (term, fold) => {
    const sql = Filter.keywordsSql(Filter.parse([term]), 3, 'a.search_text', {fold: fold ? 'x' : null});
    // the letters as they are on the column as it is: the folded pattern without the function around it
    const where = fold ? sql.sql.replace(/x\(a\.search_text\) ~\* x\((\$\d+)::text\)/g, 'a.search_text ~* $1') : sql.sql;
    const started = Date.now();
    try {
        const {rows} = await client.query(`SELECT count(*)::int AS n FROM articles a JOIN feeds f ON f.id = a.id_feed
            WHERE f.url = ANY($1::text[]) AND COALESCE(a.published_at, a.created_at) >= $2::timestamptz AND ${where}`, [feeds.map(feed => feed.url), since, ...sql.params]);
        return `${((Date.now() - started) / 1000).toFixed(1)} s, ${rows[0].n} news`;
    } catch (err) {
        return `${((Date.now() - started) / 1000).toFixed(1)} s, ${err.message.slice(0, 40)}`;
    }
};
console.log(`${DAYS} days, ${feeds.length} feeds`);
for (const term of TERMS) {
    console.log(term.padEnd(12), 'classes:', (await run(term, false)).padEnd(26), 'letters as they are:', await run(term, true));
}
await client.end();
