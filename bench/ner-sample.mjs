// The news of the NER bench: the Latvian federation's ones (the "Same affair" miss of 13.10) and a
// sample of the last day in every language, by their share. -> bench/data/ner/sample.json
import fs from 'node:fs';
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const latvia = (await c.query(`
    SELECT id, lang, title, description FROM articles
    WHERE created_at > '2026-09-28' AND (title ILIKE '%latvi%' OR title ILIKE '%letton%' OR title ILIKE '%lettland%' OR title ILIKE '%LFF%')
      AND (title ILIKE '%infantino%' OR title ILIKE '%ceferin%' OR title ILIKE '%čeferin%' OR title ILIKE '%fifa%' OR title ILIKE '%uefa%')
    LIMIT 30`)).rows;
const sample = (await c.query(`
    SELECT id, lang, title, description FROM articles TABLESAMPLE SYSTEM (1)
    WHERE created_at > now() - interval '1 day' LIMIT 270`)).rows;
const clean = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const rows = [...latvia, ...sample].map(r => ({id: r.id, lang: r.lang, text: `${clean(r.title)}. ${clean(r.description).slice(0, 600)}`}));
fs.writeFileSync('bench/data/ner/sample.json', JSON.stringify(rows, null, 1));
console.log(`${latvia.length} Latvia + ${sample.length} sample`);
const langs = {};
rows.forEach(r => langs[r.lang] = (langs[r.lang] ?? 0) + 1);
console.log(langs);
await c.end();
