// the resumes of the faithfulness bench with the resume of today: node bench/faithful-run.mjs [name]
// writes data/faithful/<name>.json (current by default), to judge fact by fact against the texts
import 'dotenv/config';
import fs from 'node:fs';
import {newUsage, ollamaResume, summaryLength} from '../services/utils/ollama.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';

const name = process.argv[2] ?? 'current';
const articles = JSON.parse(fs.readFileSync(new URL('./data/faithful/articles.json', import.meta.url), 'utf8'));
const usage = newUsage();
const count = (t) => (t ?? '').split(/\s+/).filter(Boolean).length;
const results = await mapWithConcurrency(articles, 2, async (a) => {
    const r = await ollamaResume(a.title, a.text, {language: a.language, usage});
    return {id: a.id, asked: summaryLength(a.text), words: count(r.summary), topic: r.topic, sourcing: r.sourcing, summary: r.summary};
});
const out = results.map((r, i) => r.status === 'fulfilled' ? r.value : {id: articles[i].id, error: String(r.reason)});
fs.writeFileSync(new URL(`./data/faithful/${name}.json`, import.meta.url), JSON.stringify(out, null, 1));
console.log(`${out.filter(r => r.summary).length} resumes, tokens ${JSON.stringify(usage)}`);
for (const r of out) console.log(`${r.id}: asked ${r.asked?.join('-')}, got ${r.words} ${r.error ?? ''}`);
process.exit(0);
