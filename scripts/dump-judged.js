//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: dump-judged.js
//  Description: Writes what the Python bench (scripts/bge-hybrid.py) scores, resolved against the
//               articles still in the cache, so it works on the very same data as
//               scripts/compare-grouping.js: the pairs judged by hand, and for each language the
//               articles part 3 builds its groups from
//               usage: node scripts/dump-judged.js [pairs.json] [corpus.json] [multi.json] [--days 3]
//

"use strict"

import 'dotenv/config';
import process from 'node:process';
import {writeFileSync} from 'node:fs';
import {prisma} from '../config/db.js';
import Links from '../services/utils/links.js';
import {SAME, APART, CROSS_SAME, CROSS_APART} from './judged-pairs.js';

const days = Number(process.argv[process.argv.indexOf('--days') + 1]) || 3;
const [pairsOut = 'judged.json', corpusOut = 'corpus.json', multiOut = 'multi.json'] = process.argv.slice(2).filter(a => a.endsWith('.json'));
const SIZE = 500;       // as in part 3 of compare-grouping.js

const findArticles = async (fragments) => prisma.$queryRawUnsafe(`
    SELECT DISTINCT ON (a.title) a.title, f.url AS feed,
           lower(substring(a.link from '^https?://(?:www[.])?([^/:?#]+)')) AS host
    FROM articles a JOIN feeds f ON f.id = a.id_feed
    WHERE ${fragments.map((_, i) => `a.title ILIKE '%' || $${i + 1} || '%'`).join(' OR ')}`,
    ...fragments);

// every pair inside a judged set, and whether the two articles come from different media
const pairsOf = (rows) => {
    const out = [];
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++)
        out.push([rows[i].title, rows[j].title, rows[i].host !== rows[j].host]);
    return out;
};

const collect = async (sets, label) => {
    const out = [];
    for (const [name, fragments] of Object.entries(sets)) {
        const rows = await findArticles(fragments);
        if (rows.length < 2) { console.error(`  (skipped "${name}": ${rows.length} of its articles are still in the cache)`); continue; }
        out.push(...pairsOf(rows).map(([a, b, cross]) => ({set: name, label, a, b, cross})));
    }
    return out;
};

const pairs = [...await collect(SAME, 'same'), ...await collect(APART, 'apart')];
writeFileSync(pairsOut, JSON.stringify(pairs, null, 1));
const same = pairs.filter(p => p.label === 'same').length;
console.error(`${pairs.length} pairs written to ${pairsOut}: ${same} must group, ${pairs.length - same} must not`);

// the articles of each language, as part 3 reads them, with the judged ones added and labelled
const wanted = new Map();
for (const [name, fragments] of Object.entries(SAME)) for (const f of fragments) wanted.set(f, `same:${name}`);
for (const [name, fragments] of Object.entries(APART)) for (const f of fragments) wanted.set(f, `apart:${name}`);
const labelOf = (title) => {
    for (const [fragment, label] of wanted) if (title.includes(fragment)) return label;
    return null;
};

// the language of an article is the one of its feed (a feed added by a user has none)
const languageOf = new Map();
for (const language of Links.languages()) {
    for (const url of Links.getCategoriesLinks(Links.categories(language), language)) languageOf.set(url, language);
}
const lang = (row) => languageOf.get(row.feed) ?? 'unknown';

const corpus = {};
for (const language of ['en', 'fr', 'es', 'it']) {
    const feedUrls = Links.getCategoriesLinks(Links.categories(language), language);
    const rows = await prisma.$queryRawUnsafe(`
        SELECT a.title, f.url AS feed, lower(substring(a.link from '^https?://(?:www[.])?([^/:?#]+)')) AS host
        FROM articles a JOIN feeds f ON f.id = a.id_feed
        WHERE f.url = ANY($1::text[]) AND COALESCE(a.published_at, a.created_at) >= now() - ($2 || ' day')::interval
        ORDER BY COALESCE(a.published_at, a.created_at) DESC LIMIT ${SIZE}`, feedUrls, String(days));
    const titles = new Set(rows.map(r => r.title));
    for (const fragment of wanted.keys()) {
        for (const row of await findArticles([fragment])) if (!titles.has(row.title)) { rows.push(row); titles.add(row.title); }
    }
    corpus[language] = rows.map(r => ({title: r.title, host: r.host, lang: lang(r), label: labelOf(r.title)}));
    console.error(`  ${language}: ${rows.length} articles`);
}
writeFileSync(corpusOut, JSON.stringify(corpus));
console.error(`corpus written to ${corpusOut}`);

// every language read at once, as a grouping over the whole day would: the articles of the four
// corpora, those judged across languages added, and the labels extended with the other languages
const across = new Map();
for (const [name, fragments] of Object.entries(SAME)) for (const f of fragments) across.set(f, `same:${name}`);
for (const [name, fragments] of Object.entries(CROSS_SAME)) for (const f of fragments) across.set(f, `same:${name}`);
for (const [name, fragments] of Object.entries(APART)) for (const f of fragments) across.set(f, `apart:${name}`);
for (const [name, fragments] of Object.entries(CROSS_APART)) for (const f of fragments) across.set(f, `apart:${name}`);
const acrossOf = (title) => {
    for (const [fragment, label] of across) if (title.includes(fragment)) return label;
    return null;
};
const seen = new Map();
for (const rows of Object.values(corpus)) for (const row of rows) if (!seen.has(row.title)) seen.set(row.title, row);
for (const fragment of across.keys()) {
    for (const row of await findArticles([fragment])) if (!seen.has(row.title)) seen.set(row.title, row);
}
const multi = [...seen.values()].map(r => ({title: r.title, host: r.host, lang: r.lang ?? lang(r), label: acrossOf(r.title)}));
writeFileSync(multiOut, JSON.stringify(multi));
console.error(`${multi.length} articles of every language written to ${multiOut}, ${multi.filter(r => r.label).length} of them judged`);
process.exit(0);
