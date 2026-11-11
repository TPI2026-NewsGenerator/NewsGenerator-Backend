//
//  Author: Fabian Rostello
//  Date: 11.11.2026
//  File: page-image-fallback.mjs
//  Description: The pages of the cards of the saved briefings that have no picture: which of them the current rule (pageImage of
//               crawlers.js) still finds none for, and what a fallback rule (the featured image of the article inside the page)
//               would find in them, to be read by hand. Writes bench/data/page-image/<date>.json
//
//  node --env-file=.env bench/page-image-fallback.mjs
//

import 'dotenv/config';
import {writeFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
import {prisma} from '../config/db.js';
import {pageImage} from '../services/utils/crawlers.js';
import {fetchPublicUrl, readText} from '../services/utils/public-url.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';

const rows = await prisma.$queryRawUnsafe(`SELECT DISTINCT i->'lead'->>'url' AS url FROM briefings b, jsonb_array_elements(b.items) i
    WHERE b.status='ready' AND (i->>'thumbnail') IS NULL AND (i->'lead'->>'url') IS NOT NULL`);
console.log(`${rows.length} pages of cards without a picture`);

const HEADERS = {'User-Agent': 'Mozilla/5.0 (compatible; NewsGenerator/1.0; +RSS reader)', 'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'};
// the candidate rules, each answering the address of an image or null
const RULES = {
    microdata: (document) => document.querySelector('meta[itemprop="image"], link[itemprop="image"]')?.getAttribute('content') ?? document.querySelector('meta[itemprop="image"], link[itemprop="image"]')?.getAttribute('href')
        ?? document.querySelector('[itemprop="image"] img, img[itemprop="image"]')?.getAttribute('src') ?? null,
    wpPostImage: (document) => document.querySelector('img.wp-post-image')?.getAttribute('src') ?? null,
    thumbnailBox: (document) => document.querySelector('.post-thumbnail img, .entry-thumbnail img, .featured-image img, .article-image img, .post-image img, figure.wp-block-post-featured-image img')?.getAttribute('src') ?? null,
    firstOfArticle: (document) => document.querySelector('article img[src]')?.getAttribute('src') ?? null,
};

const results = await mapWithConcurrency(rows, 8, async ({url}) => {
    const {res} = await fetchPublicUrl(url, {headers: HEADERS, timeoutMs: 20000, maxRedirects: 5});
    if (!res.ok) return {url, status: res.status};
    const html = await readText(res, 20000);
    const {document} = parseHTML(html);
    const found = {};
    for (const [name, rule] of Object.entries(RULES)) {
        try {
            const address = rule(document);
            if (address) found[name] = new URL(address, url).href;
        } catch {
            // not an address
        }
    }
    return {url, status: 200, current: pageImage(document, url), found};
});
const done = results.map((result, i) => result.status === 'fulfilled' ? result.value : {url: rows[i].url, error: String(result.reason?.message ?? result.reason)});
const read = done.filter(row => row.status === 200);
const none = read.filter(row => !row.current);
const count = (name) => none.filter(row => row.found[name]).length;
console.log(`read ${read.length}, ${none.length} with no picture by the current rule (the others gained one since: og:image, JSON-LD)`);
for (const name of Object.keys(RULES)) console.log(`  ${name}: ${count(name)}`);
console.log(`any rule: ${none.filter(row => Object.keys(row.found).length > 0).length}`);
writeFileSync(`bench/data/page-image/${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(done, null, 1));
await prisma.$disconnect();
process.exit(0);
