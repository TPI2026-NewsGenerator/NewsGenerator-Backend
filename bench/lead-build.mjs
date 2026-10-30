// Reading the articles during the ingestion, stage 1: the pages of the rel3 corpus (feeds of 24.09)
// read by Readability as the ingestion would, their start kept (the first 300 words of their text
// and quote blocks). The weight of a page: bench/lead-weight.sh (node's fetch crashes on hundreds of pages at once).
// node bench/lead-build.mjs  ->  bench/data/lead/pages.json
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';
import {Crawlers} from '../services/utils/crawlers.js';

const OUT = 'bench/data/lead';
const KEEP_WORDS = 300;
fs.mkdirSync(OUT, {recursive: true});

const corpus = JSON.parse(fs.readFileSync('bench/data/legacy/rel3/corpus2.json', 'utf8')).filter(a => a.origin === 'db');
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const {rows} = await c.query('SELECT id, link FROM articles WHERE id = ANY($1::int[])', [corpus.map(a => Number(a.key.slice(2)))]);
await c.end();
const linkOf = new Map(rows.map(r => [`db${r.id}`, r.link]));
const urls = [...new Set(corpus.map(a => linkOf.get(a.key)).filter(Boolean))];

const words = (text) => (text ?? '').split(/\s+/).filter(Boolean);
let t = Date.now();
const pages = new Map((await Crawlers.Html(urls)).map(p => [p.url, p]));
const crawlSeconds = (Date.now() - t) / 1000;

const out = {};
for (const a of corpus) {
    const link = linkOf.get(a.key);
    const page = pages.get(link);
    const blocks = (page?.blocks ?? []).filter(b => b.kind === 'text' || b.kind === 'quote');
    // the blocks when they hold the text, else the flat text (a page set in divs), as extract.js does
    const inBlocks = words(blocks.map(b => b.text).join(' '));
    const flat = words(page?.content);
    const body = inBlocks.length >= flat.length / 2 ? inBlocks : flat;
    out[a.key] = {link, words: flat.length, start: body.slice(0, KEEP_WORDS).join(' ')};
}
fs.writeFileSync(`${OUT}/pages.json`, JSON.stringify(out));

const read = Object.values(out).filter(p => p.words >= 60).length;
console.log(`${corpus.length} articles, ${urls.length} pages crawled in ${Math.round(crawlSeconds)} s (${(urls.length / crawlSeconds).toFixed(1)} pages/s)`);
console.log(`read >= 60 words: ${read} (${Math.round(100 * read / corpus.length)}%)`);
process.exit(0);
