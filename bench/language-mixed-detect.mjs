// Which feeds a "several languages" test would flag, from their 30 last news (17.10.2026, see
// language-mixed-feeds.mjs). Read only.
//   node --env-file=.env bench/language-mixed-detect.mjs [share=0.2] [min=3] [franc] [news=30]
import process from 'node:process';
import pg from 'pg';
import {readFileSync} from 'node:fs';
import {franc} from 'franc';

const SHARE = Number(process.argv[2] ?? 0.2);
const MIN = Number(process.argv[3] ?? 3);
const LIMIT = Number(process.argv[5] ?? 30);
const WITH_FRANC = process.argv[4] === 'franc';
const FRANC_ONLY = {eng: 'en', fra: 'fr', spa: 'es', ita: 'it', deu: 'de', nld: 'nl', por: 'pt', ces: 'cs', pol: 'pl'};
const source = readFileSync(new URL('../services/utils/language.js', import.meta.url), 'utf8');
const WORDS = eval(`(${source.match(/const WORDS = (\{[\s\S]*?\n\});/)[1]})`);
const SETS = Object.fromEntries(Object.entries(WORDS).map(([l, w]) => [l, new Set(w.split(' '))]));
// the language a text clearly is in: 2 short words at least, 2 more than any other
const clearly = (text, margin) => {
    const words = (text ?? '').toLowerCase().match(/[\p{L}]+/gu) ?? [];
    const hits = Object.entries(SETS).map(([l, s]) => [l, words.filter(w => s.has(w)).length]).sort((a, b) => b[1] - a[1]);
    const told = hits[0][1] >= 2 && hits[0][1] - hits[1][1] >= margin ? hits[0][0] : null;
    // and franc, among the 9 languages, on the title says the same
    return told && (!WITH_FRANC || FRANC_ONLY[franc(text, {minLength: 10, only: Object.keys(FRANC_ONLY)})] === told) ? told : null;
};

const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const {rows} = await c.query(`SELECT f.url,
        COALESCE((SELECT uf.language FROM user_feeds uf WHERE uf.url = f.url AND uf.language IS NOT NULL LIMIT 1),
                 (SELECT d.language FROM directory_feeds d WHERE d.url = f.url)) AS feed_language,
        array_agg(a.title || ' ' || a.description) AS texts
    FROM feeds f JOIN LATERAL (SELECT title, description FROM articles WHERE id_feed = f.id
        AND created_at > now() - interval '7 days' ORDER BY created_at DESC LIMIT ${LIMIT}) a ON true
    GROUP BY f.url HAVING count(*) >= 20`);
await c.end();
for (const margin of [1, 2]) {
    const flagged = [];
    for (const f of rows) {
        const counts = {};
        for (const t of f.texts) { const l = clearly(t, margin); if (l) counts[l] = (counts[l] ?? 0) + 1; }
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        const told = sorted.reduce((s, [, n]) => s + n, 0);
        const others = told - (sorted[0]?.[1] ?? 0);
        if (others >= MIN && others >= SHARE * told && SETS[f.feed_language]) flagged.push(`${f.url.slice(0, 75)} (${f.feed_language}) ${JSON.stringify(sorted)}`);
    }
    console.log(`\nmargin ${margin}: ${flagged.length} of ${rows.length} feeds flagged (other languages >= ${MIN} and >= ${SHARE * 100}% of the told)`);
    flagged.forEach(l => console.log('  ' + l));
}
