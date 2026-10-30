// the pages of the faithfulness bench read again with their blocks: node bench/faithful-blocks.mjs
import 'dotenv/config';
import fs from 'node:fs';
import {Crawlers} from '../services/utils/crawlers.js';
const file = new URL('./data/faithful/articles.json', import.meta.url);
const articles = JSON.parse(fs.readFileSync(file, 'utf8'));
const pages = new Map((await Crawlers.Html(articles.map(a => a.link))).map(p => [p.url, p]));
for (const a of articles) a.blocks = pages.get(a.link)?.blocks ?? [];
fs.writeFileSync(file, JSON.stringify(articles, null, 1));
console.log(articles.map(a => `${a.id}:${a.blocks.length}`).join(' '));
process.exit(0);
