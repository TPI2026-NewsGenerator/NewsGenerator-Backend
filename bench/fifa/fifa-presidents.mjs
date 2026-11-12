//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: fifa-presidents.mjs
//  Description: Measures the public pages of FIFA as a source of the presidents of the 211 associations (fifa-site.js): reads each page once, 1.2 s apart, with a
//               User-Agent that says who reads, keeps the answers in data/fifa-presidents.json (so the pages are asked once), and tells how many pages
//               give a president and how far the names agree with the ones Wikidata gave (the table fifa_leaders, read only)
//
//  node --env-file=.env bench/fifa/fifa-presidents.mjs [--refresh]
//

import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import process from 'node:process';
import {setTimeout as sleep} from 'node:timers/promises';
import {prisma} from '../../config/db.js';
import {ASSOCIATIONS} from '../../services/utils/fifa-members.js';
import {leaderOfPage, pageUrl} from '../../services/utils/fifa-site.js';
import {mentionKey} from '../../services/utils/mentions.js';

const FILE = new URL('./data/fifa-presidents.json', import.meta.url);
const HEADERS = {'User-Agent': 'NewsGenerator/1.0 (+https://news.fabianrostello.com; personal news reader, reads each public page once)', Accept: 'text/html'};
const saved = existsSync(FILE) && !process.argv.includes('--refresh') ? JSON.parse(readFileSync(FILE, 'utf8')) : {};

let asked = 0;
for (const member of ASSOCIATIONS) {
    if (saved[member.fifa]) continue;
    asked++;
    try {
        const response = await fetch(pageUrl(member.fifa), {headers: HEADERS, signal: AbortSignal.timeout(25000)});
        saved[member.fifa] = response.ok ? {status: 200, leader: leaderOfPage(await response.text())} : {status: response.status, leader: null};
    } catch (error) {
        saved[member.fifa] = {status: 0, error: String(error.message).slice(0, 80), leader: null};
    }
    await sleep(1200);
    if (asked % 25 === 0) { writeFileSync(FILE, JSON.stringify(saved, null, 1)); console.log(`${asked} pages read`); }
}
writeFileSync(FILE, JSON.stringify(saved, null, 1));

const codes = ASSOCIATIONS.map(member => member.fifa);
const ok = codes.filter(code => saved[code]?.leader);
console.log(`\n${ok.length} of ${codes.length} pages give a president; statuses: ${JSON.stringify(Object.entries(Object.groupBy(codes, code => saved[code]?.status ?? 'none')).map(([status, list]) => `${status}: ${list.length}`))}`);
console.log('no president:', codes.filter(code => !saved[code]?.leader).map(code => `${code}(${saved[code]?.status})`).join(' '));

// against Wikidata (what the table holds), by the last words of the names
const wikidata = new Map((await prisma.$queryRawUnsafe('SELECT member_qid, name FROM fifa_leaders')).map(row => [row.member_qid, row.name]));
const lastWords = (name) => mentionKey(name).split(' ').filter(word => word.length > 2);
const same = (a, b) => { const x = new Set(lastWords(a)), y = lastWords(b); return y.some(word => x.has(word)); };
let both = 0, agree = 0;
const differ = [];
for (const member of ASSOCIATIONS) {
    const fifa = saved[member.fifa]?.leader?.name, wiki = wikidata.get(member.qid);
    if (!fifa || !wiki) continue;
    both++;
    if (same(fifa, wiki)) agree++;
    else differ.push(`${member.fifa}: FIFA "${fifa}" / Wikidata "${wiki}"`);
}
console.log(`\nboth sources give a president for ${both}: the names share a word for ${agree} (${both ? Math.round(100 * agree / both) : 0}%)`);
console.log(differ.join('\n'));
console.log(`\nonly Wikidata: ${ASSOCIATIONS.filter(member => wikidata.has(member.qid) && !saved[member.fifa]?.leader).length}, only FIFA: ${ASSOCIATIONS.filter(member => !wikidata.has(member.qid) && saved[member.fifa]?.leader).length}`);
await prisma.$disconnect();
