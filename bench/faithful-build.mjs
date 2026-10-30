// the articles of the faithfulness bench: recent articles of varied media, read now and kept, so every
// variant of the resume is judged on the same texts. node bench/faithful-build.mjs
// 10 French articles summarized in French, 10 English ones in French (the briefing of a French reader),
// 10 English ones in English. One per medium, 60 to 1500 words.
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';
import {Crawlers} from '../services/utils/crawlers.js';
import {canSummarize} from '../services/utils/ollama.js';

const count = (t) => (t ?? '').split(/\s+/).filter(Boolean).length;
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const pick = async (lang, exclude) => (await c.query(`
    SELECT DISTINCT ON (medium) link, title, medium FROM articles
    WHERE lang = $1 AND created_at > now() - interval '3 days' AND link NOT LIKE 'https://news.google.com/%'
      AND medium <> ALL($2::text[])
    ORDER BY medium, md5(link)`, [lang, exclude])).rows.sort((a, b) => a.link.localeCompare(b.link));
const fr = await pick('fr', []);
const en = await pick('en', []);
await c.end();
console.log(`candidates: ${fr.length} French media, ${en.length} English media`);

// read more than needed: many pages are teasers or too long
const read = async (rows, n) => {
    const shuffled = rows.map(r => [parseInt(r.link.length * 7919 % 1000), r]).sort((a, b) => a[0] - b[0]).map(([, r]) => r).slice(0, n * 3);
    const pages = new Map((await Crawlers.Html(shuffled.map(r => r.link))).map(p => [p.url, p]));
    return shuffled.map(r => ({...r, text: pages.get(r.link)?.content ?? ''}))
        .filter(r => canSummarize(r.text) && count(r.text) <= 1500).slice(0, n);
};
const french = await read(fr, 10);
const english = await read(en, 20);
const articles = [
    ...french.map((a, i) => ({id: `fr${i}`, language: 'French', ...a})),
    ...english.slice(0, 10).map((a, i) => ({id: `enfr${i}`, language: 'French', ...a})),
    ...english.slice(10, 20).map((a, i) => ({id: `en${i}`, language: 'English', ...a})),
];
fs.writeFileSync(new URL('./data/faithful/articles.json', import.meta.url), JSON.stringify(articles, null, 1));
console.log(`${articles.length} articles kept: ${articles.map(a => `${a.id} ${a.medium} ${count(a.text)}w`).join(', ')}`);
process.exit(0);
