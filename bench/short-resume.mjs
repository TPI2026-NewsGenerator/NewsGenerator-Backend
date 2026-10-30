// the summaries of short texts (60 to 250 words), to read beside them: node bench/short-resume.mjs <regex> [n]
import 'dotenv/config';
import pg from 'pg';
import {Crawlers} from '../services/utils/crawlers.js';
import {canSummarize, ollamaResume, summaryLength} from '../services/utils/ollama.js';
const [pattern = 'PSG', n = 4] = process.argv.slice(2);
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const {rows} = await c.query(`SELECT DISTINCT ON (link) link, title FROM articles WHERE search_text ~* $1 AND created_at > now() - interval '7 days' AND link NOT LIKE 'https://news.google.com/%' ORDER BY link LIMIT 60`, [pattern]);
await c.end();
const pages = await Crawlers.Html(rows.map(r => r.link));
const count = (t) => (t ?? '').split(/\s+/).filter(Boolean).length;
const short = pages.filter(p => canSummarize(p.content) && count(p.content) < 250).slice(0, Number(n));
for (const p of short) {
    const title = rows.find(r => r.link === p.url)?.title;
    const {summary} = await ollamaResume(title, p.content, {language: 'French'});
    console.log(`\n######## ${title} (${count(p.content)} words, asked ${summaryLength(p.content).join('-')}, got ${count(summary)})\n--- TEXT\n${p.content.replace(/\s+/g, ' ')}\n--- SUMMARY\n${summary}`);
}
process.exit(0);
