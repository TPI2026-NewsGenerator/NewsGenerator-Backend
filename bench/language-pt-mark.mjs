// Portuguese news reached through a search in another language were told that language (3.11.2026: a
// poder360.com.br card on LaLiga's referees told Italian; 34-42% of the Portuguese news told Portuguese when
// the language of the feed is another). The words only Portuguese writes (ã, -ões in small letters, see
// language.js MARKED) against the news of national media, read: how many Portuguese news they tell right
// with each feed language, and whether any news of the other languages becomes Portuguese. Read only.
//   node --env-file=.env bench/language-pt-mark.mjs [perGroup=3000]
import process from 'node:process';
import pg from 'pg';
import {languageOf} from '../services/utils/language.js';

const PER_GROUP = Number(process.argv[2] ?? 3000);
const GROUPS = {
    pt: String.raw`a.medium ~ '(\.pt|\.com\.br)$' OR a.medium IN ('poder360.com.br', 'noticiasaominuto.com')`,
    es: String.raw`a.medium ~ '\.es$' OR a.medium IN ('marca.com', 'as.com', 'mundodeportivo.com')`,
    it: String.raw`a.medium ~ '\.it$'`,
    fr: String.raw`a.medium ~ '\.fr$'`,
    en: String.raw`a.medium ~ '\.co\.uk$' OR a.medium IN ('theguardian.com', 'espn.com', 'nytimes.com')`,
    de: String.raw`a.medium ~ '\.de$'`,
};
const pct = (part, whole) => (100 * part / whole).toFixed(1);

const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const texts = {};
for (const [language, condition] of Object.entries(GROUPS)) {
    const {rows} = await client.query(`SELECT a.title, a.description FROM articles a
        WHERE a.published_at > now() - interval '5 days' AND (${condition}) ORDER BY random() LIMIT $1`, [PER_GROUP]);
    texts[language] = rows.map(row => `${row.title} ${row.description ?? ''}`);
}
await client.end();

console.log('Portuguese news told Portuguese, by the language of the feed:');
for (const feed of [null, 'it', 'es', 'en', 'fr', 'pt']) {
    console.log(`  feed ${String(feed).padEnd(4)} ${pct(texts.pt.filter(text => languageOf(text, feed) === 'pt').length, texts.pt.length)}%`);
}
console.log('News of the other languages told Portuguese (with their own language as the feed):');
for (const language of ['es', 'it', 'fr', 'en', 'de']) {
    const wrong = texts[language].filter(text => languageOf(text, language) === 'pt').length;
    console.log(`  ${language}: ${wrong} of ${texts[language].length}; right ${pct(texts[language].filter(text => languageOf(text, language) === language).length, texts[language].length)}%`);
}
