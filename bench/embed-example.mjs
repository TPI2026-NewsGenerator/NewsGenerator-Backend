// An example for the README / the user: what bge-m3 gives for a few titles, as pgvector stores them,
// and the likeness assign_stories computes (read only, nothing stored)
// node --env-file=.env bench/embed-example.mjs
import pg from 'pg';
import {embed, toSparsevec, toVector} from '../services/utils/embedder.js';

const texts = [
    'Spain beat Croatia 2-1 in the Nations League',
    'Croatia lose 2-1 to Spain as Yamal scores late winner',
    'Egypt vs Angola - Betting Tips',
    'Togo vs Burundi - Betting Tips',
];
const vectors = await embed(texts);
const [a] = vectors;
console.log('DENSE of A: 1024 numbers, first 8:', Array.from(a.dense.slice(0, 8)).map(x => x.toFixed(4)).join(', '),
            '| norm', Math.sqrt(a.dense.reduce((s, x) => s + x * x, 0)).toFixed(4));
console.log('SPARSE of A (token id: weight):', JSON.stringify(a.sparse));
console.log('pgvector halfvec text, start:', toVector(a.dense).slice(0, 80) + '...', `(${toVector(a.dense).length} characters)`);
console.log('pgvector sparsevec text:', toSparsevec(a.sparse));

const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const pairs = [[0, 1], [0, 2], [2, 3]];
for (const [i, j] of pairs) {
    const {rows: [r]} = await c.query(`
        SELECT -($1::halfvec(1024) <#> $2::halfvec(1024)) AS dense,
               -($3::sparsevec(250002) <#> $4::sparsevec(250002)) AS sparse`,
        [toVector(vectors[i].dense), toVector(vectors[j].dense), toSparsevec(vectors[i].sparse), toSparsevec(vectors[j].sparse)]);
    console.log(`"${texts[i]}" / "${texts[j]}": dense ${(+r.dense).toFixed(3)} + sparse ${(+r.sparse).toFixed(3)} = ${(+r.dense + +r.sparse).toFixed(3)}`);
}
await c.end();
