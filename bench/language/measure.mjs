// Language of each feed read from its last news, against the language it was stored with.
// node bench/language/measure.mjs
import 'dotenv/config';
import pg from 'pg';
import {languageOf} from '../../services/utils/language.js';

const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rows} = await client.query(`
    SELECT f.url, (SELECT uf.language FROM user_feeds uf WHERE uf.url = f.url LIMIT 1) AS declared,
           array_agg(a.title || ' ' || COALESCE(left(a.description, 400), '') ORDER BY a.id DESC) AS texts
    FROM feeds f JOIN articles a ON a.id_feed = f.id
    WHERE f.url NOT LIKE 'https://news.google.com/%'
      AND a.created_at > now() - interval '3 days'
    GROUP BY f.url`);
await client.end();

const vote = (texts) => {
    const counts = {};
    let told = 0;
    for (const text of texts.slice(0, 30)) {
        const language = languageOf(text);
        if (!language) continue;
        told++;
        counts[language] = (counts[language] ?? 0) + 1;
    }
    const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    return {best, share: told ? n / told : 0, told, of: Math.min(texts.length, 30)};
};

const out = rows.map(row => ({url: row.url.slice(0, 70), declared: row.declared, ...vote(row.texts)}));
const odd = out.filter(row => row.declared && row.best !== row.declared);
console.log(`${out.length} feeds, ${odd.length} where the vote differs from the declared language`);
console.table(odd);
console.table(out.filter(row => row.share < 0.7 || row.told < row.of / 2).slice(0, 40));
