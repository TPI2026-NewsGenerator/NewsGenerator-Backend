// The persons linked to no item whose name is the label of an item Wikidata found under a longer name
// ("Javier Tebas" found as "Javier Tebas Medrano"): exactItems took only the text found before
// 20.10.2026. Searches each as exactItems does, old and new rule on the same answer, and writes
// relink.sql for the user to run (linked_at null: the tagger looks for them again with personItem and
// famousHuman); runs nothing on the database itself. found.json keeps the answers: a stopped run goes on
// node --env-file=.env bench/label-items/relink.mjs
import fs from 'node:fs';
import pg from 'pg';
import {mentionKey} from '../../services/utils/mentions.js';

const NOT_NAMED = /^(Wikimedia |family name|surname|given name|male given name|female given name|unisex given name|scholarly article|scientific article)/i;
const HEADERS = {'User-Agent': 'NewsGenerator/1.0 (https://news.fabianrostello.com; rostellofabian@gmail.com)'};
const PAUSE_MS = 400;
const file = new URL('./found.json', import.meta.url);
const found = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};

const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const {rows} = await db.query(`SELECT id, name, lang, seen FROM mentions WHERE kind = 'person' AND qid IS NULL
    AND linked_at IS NOT NULL ORDER BY seen DESC`);
await db.end();

const search = async (name, language) => {
    for (;;) {
        const res = await fetch(`https://www.wikidata.org/w/api.php?${new URLSearchParams({action: 'wbsearchentities',
            search: String(name).slice(0, 100), language, uselang: 'en', type: 'item', limit: '10', format: 'json'})}`, {headers: HEADERS});
        if (res.status === 429 || res.status >= 500) {
            await new Promise(resolve => setTimeout(resolve, (Number(res.headers.get('retry-after')) || 60) * 1000));
            continue;
        }
        const answer = await res.json();
        if (answer.error && language !== 'en' && !/busy|maxlag/.test(answer.error.code ?? '')) return search(name, 'en');
        if (answer.error) {
            await new Promise(resolve => setTimeout(resolve, 60000));
            continue;
        }
        return (answer.search ?? []).filter(item => /^Q\d+$/.test(item.id) && !NOT_NAMED.test(item.description ?? ''));
    }
};

let done = 0;
for (const row of rows) {
    if (!found[row.id]) {
        const key = mentionKey(row.name);
        const items = key.length < 2 ? [] : await search(row.name, row.lang || 'en');
        const old = new Set(items.filter(item => mentionKey(item.match?.text ?? item.label) === key).map(item => item.id));
        const gained = items.filter(item => !old.has(item.id) && mentionKey(item.label ?? '') === key)
            .map(item => ({qid: item.id, label: item.label, description: item.description ?? null, match: item.match?.text ?? null}));
        found[row.id] = {name: row.name, seen: row.seen, old: old.size, gained};
        if (++done % 50 === 0) {
            fs.writeFileSync(file, JSON.stringify(found));
            console.log(`${done} searched, ${Object.values(found).filter(f => f.gained.length).length} gain an item`);
        }
        await new Promise(resolve => setTimeout(resolve, PAUSE_MS));
    }
}
fs.writeFileSync(file, JSON.stringify(found));
// full names only, the ones measured (bench/lone-items): a word alone found by its label would be linked
// to the one item ('David', the king of Israel; 'Ronaldo'); those stay in found.json
const again = rows.filter(row => found[row.id]?.gained.length && mentionKey(row.name).includes(' '));
console.log(`${again.length} of ${rows.length} persons gain an item by its label as a full name, ${again.filter(row => row.seen >= 20).length} seen 20 times or more`);
for (const row of again.slice(0, 60)) console.log(`${row.seen}\t${row.name}: ${found[row.id].gained.map(g => `${g.qid} ${g.description}`).join('; ')}`);
fs.writeFileSync(new URL('./relink.sql', import.meta.url), `-- ${again.length} persons linked to no item whose name is the label of an item found under a longer name (exactItems, 20.10.2026)\n`
    + `UPDATE mentions SET qid = NULL, linked_at = NULL WHERE kind = 'person' AND qid IS NULL AND id = ANY(ARRAY[${again.map(row => row.id).join(',')}]);\n`);
