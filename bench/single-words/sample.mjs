// The persons of one word linked to a human (items read by bench/link-types/relink.mjs): the 80 most seen
// and 100 at random seen 20 times or more, each with 3 titles of its news, to judge by hand: is the item
// the person the news name? Writes sample.json (read only). node --env-file=.env bench/single-words/sample.mjs
import fs from 'node:fs';
import pg from 'pg';
const items = JSON.parse(fs.readFileSync(new URL('../link-types/items.json', import.meta.url), 'utf8'));
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const all = (await db.query(`SELECT id, name, lang, qid, seen FROM mentions WHERE kind = 'person' AND qid IS NOT NULL AND key NOT LIKE '% %' ORDER BY seen DESC`)).rows
    .filter(row => items[row.qid]?.human);
const top = all.slice(0, 80);
const rest = all.slice(80).filter(row => row.seen >= 20).map(row => [Math.random(), row]).sort((a, b) => a[0] - b[0]).slice(0, 100).map(([, row]) => row);
const sample = [];
for (const row of [...top, ...rest]) {
    const {rows} = await db.query(`SELECT title FROM (SELECT DISTINCT ON (a.title) a.title, a.id FROM article_mentions am JOIN articles a ON a.id = am.id_article
        WHERE am.id_mention = $1 AND a.title IS NOT NULL ORDER BY a.title, a.id DESC LIMIT 100) t ORDER BY id DESC LIMIT 3`, [row.id]);
    const item = items[row.qid];
    sample.push({name: row.name, lang: row.lang, seen: row.seen, qid: row.qid, label: item.label, description: item.description, links: item.links, top: top.includes(row), titles: rows.map(r => r.title)});
}
await db.end();
fs.writeFileSync(new URL('./sample.json', import.meta.url), JSON.stringify(sample, null, 1));
console.log(`${all.length} linked to a human, ${sample.length} sampled`);
