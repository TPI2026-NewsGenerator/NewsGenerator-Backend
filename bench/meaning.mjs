// search by meaning: the closest news of a sentence, to set the threshold. node bench/meaning.mjs <lang> [days] -- "phrase" ...
import 'dotenv/config';
import pg from 'pg';
import Links from '../services/utils/links.js';
import {embed, toSparsevec, toVector} from '../services/utils/embedder.js';
const [lang = 'fr', days = 7] = process.argv.slice(2, 4);
const phrases = process.argv.slice(process.argv.indexOf('--') + 1);
const feeds = Links.getCategoriesLinks(Links.categories(lang), lang);
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const vectors = await embed(phrases);
for (const [i, phrase] of phrases.entries()) {
    const t = Date.now();
    const {rows} = await c.query(`SELECT DISTINCT ON (score, a.title) a.title, a.medium,
            -(a.text_dense <#> $2::vector) AS dense, -(a.text_sparse <#> $3::sparsevec) AS sparse,
            -(a.text_dense <#> $2::vector) - 0.5 * (a.text_sparse <#> $3::sparsevec) AS score
        FROM articles a JOIN feeds f ON f.id = a.id_feed
        WHERE f.url = ANY($1::text[]) AND a.embedded_at IS NOT NULL
          AND COALESCE(a.published_at, a.created_at) >= now() - make_interval(days => $4::int)
        ORDER BY score DESC, a.title LIMIT 400`,
        [feeds, toVector(vectors[i].dense), toSparsevec(vectors[i].sparse), days]);
    const at = (n) => rows[n - 1]?.score?.toFixed(3) ?? '-';
    const over = (x) => rows.filter(r => r.score >= x).length;
    console.log(`\n=== ${phrase}  (${Date.now() - t} ms)  rank1 ${at(1)} r10 ${at(10)} r30 ${at(30)} r100 ${at(100)} | ≥.45 ${over(.45)} ≥.5 ${over(.5)} ≥.55 ${over(.55)} ≥.6 ${over(.6)}`);
    for (const [k, r] of rows.entries()) {
        if (k < 12 || [19, 29, 49, 79].includes(k)) console.log(`  ${String(k + 1).padStart(3)} ${r.score.toFixed(3)} d${r.dense.toFixed(2)} s${r.sparse.toFixed(2)}  ${r.title.slice(0, 95)}  [${r.medium}]`);
    }
}
await c.end();
process.exit(0);
