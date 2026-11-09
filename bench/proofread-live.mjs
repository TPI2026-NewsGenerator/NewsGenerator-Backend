//
//  Author: Fabian Rostello
//  Date: 09.11.2026
//  File: proofread-live.mjs
//  Description: The proofreading of the server (services/utils/proofread.js) run for real, on the cards of briefings already measured
//               (bench/data/enzo-measure-<profile>-<n>-raw.json): (1) on the cards as they are, what it takes out and what it leaves, by hand to
//               judge; (2) on copies where known defects are put in, the share it takes out and restores to the exact text; the time and the
//               tokens. Nothing is saved
//
//  node --env-file=.env bench/proofread-live.mjs <file.json> [<file.json>...]
//

import process from 'node:process';
import {readFileSync} from 'node:fs';
import {newUsage} from '../services/utils/ollama.js';
import {proofreadCards} from '../services/utils/proofread.js';
import {ORIGINAL_START, UNCHECKED} from '../services/utils/original-marks.js';

const files = process.argv.slice(2);
if (files.length === 0) {
    console.error('node --env-file=.env bench/proofread-live.mjs <file.json> [<file.json>...]');
    process.exit(1);
}
const cards = files.flatMap(file => JSON.parse(readFileSync(file, 'utf8')));
const language = 'en';
const readers = cards.filter(card => (card.language ?? 'en') === 'en' || card.titleTranslation);
console.log(`${cards.length} cards of ${files.length} file(s)\n`);

// ---- 1. the cards as they are
{
    const usage = newUsage();
    const started = Date.now();
    const done = await proofreadCards(cards, language, {usage, label: 'real'});
    const changed = done.filter((card, i) => card !== cards[i]);
    console.log(`\n${changed.length} cards changed in ${Math.round((Date.now() - started) / 1000)} s`);
    for (const card of changed) {
        const before = cards[done.indexOf(card)];
        console.log(`  - ${JSON.stringify(card.proofread)}\n      title: ${(before.titleTranslation ?? before.title).slice(0, 90)}`);
    }
}

// ---- 2. the same cards with known defects put in, every card one defect, in the title or at the start of the sentences of the three ways
const FIRST = ['summary', 'points', 'digest'];
const keyOf = (card, way) => way === 'summary' ? (card.translation ? 'translation' : 'summary') : way === 'points' ? (card.pointsTranslation ? 'pointsTranslation' : 'points') : (card.digestTranslation ? 'digestTranslation' : 'digest');
const inShown = (card, way) => card[keyOf(card, way)];
const DEFECTS = [
    ['title label before', (card) => ({title: 'VIDEO: '}), 'title', 'before'],
    ['title label after', (card) => ({title: ' (pic)'}), 'title', 'after'],
    ['title medium after', (card) => ({title: ' | Yalla Shoot'}), 'title', 'after'],
    ['title credit after', (card) => ({title: ' - by Paolo Moramarco'}), 'title', 'after'],
    ['title paywall after', (card) => ({title: ' [premium]'}), 'title', 'after'],
    ['dateline GENEVA --', () => 'GENEVA -- ', 'text', 'before'],
    ['dateline Conakry –', () => 'Conakry – ', 'text', 'before'],
    ['dateline with date', () => 'NAIROBI, Kenya, November 4, 2026 – ', 'text', 'before'],
    ['credit HIBAPRESS:', () => 'HIBAPRESS: ', 'text', 'before'],
    ['wire (Reuters)', () => 'WASHINGTON (Reuters) - ', 'text', 'before'],
];
const clean = readers.filter(card => (card.titleTranslation ?? card.title).split(/\s+/).length >= 5 && inShown(card, 'summary')?.split(/\n\n/)[0].split(/\s+/).length >= 8
    && !inShown(card, 'summary').includes(ORIGINAL_START) && !inShown(card, 'summary').includes(UNCHECKED));
const per = Math.floor(clean.length / DEFECTS.length);
const planted = [];
const copies = [];
DEFECTS.forEach(([name, make, where, side], k) => {
    for (const base of clean.slice(k * per, (k + 1) * per)) {
        const copy = {...base};
        const piece = where === 'title' ? make(base).title : make(base);
        if (where === 'title') {
            const key = base.titleTranslation ? 'titleTranslation' : 'title';
            copy[key] = side === 'before' ? piece + base[key] : base[key] + piece;
        } else {
            for (const way of FIRST) {
                const key = keyOf(base, way);
                if (copy[key]) copy[key] = piece + copy[key];
            }
        }
        copies.push(copy);
        planted.push({name, base, piece: piece.trim(), where});
    }
});
{
    const usage = newUsage();
    const started = Date.now();
    const done = await proofreadCards(copies, language, {usage, label: 'planted', log: process.env.VERBOSE ? console : {log: () => {}, error: console.error}});
    const seconds = Math.round((Date.now() - started) / 1000);
    const rows = {};
    done.forEach((card, i) => {
        const {name, base, where} = planted[i];
        const row = rows[name] ?? (rows[name] = {total: 0, restored: 0, partly: 0});
        row.total++;
        const keys = where === 'title' ? [base.titleTranslation ? 'titleTranslation' : 'title'] : FIRST.map(way => keyOf(base, way)).filter(key => base[key]);
        const same = keys.filter(key => card[key] === base[key]).length;
        if (same === keys.length) row.restored++;
        else if (same > 0 || keys.some(key => card[key] !== copies[i][key])) { row.partly++; for (const key of keys) if (card[key] !== base[key]) console.log(`    partly [${name}] ${key}: was ${JSON.stringify(String(base[key]).slice(0, 90))}
      now ${JSON.stringify(String(card[key]).slice(0, 90))}`); }
    });
    console.log(`\nknown defects put in ${copies.length} cards, restored to the exact text (${seconds} s, tokens ${JSON.stringify(usage)}):`);
    for (const [name, row] of Object.entries(rows)) console.log(`  ${name.padEnd(22)} restored ${row.restored}/${row.total}${row.partly ? `, partly ${row.partly}` : ''}`);
}
process.exit(0);
