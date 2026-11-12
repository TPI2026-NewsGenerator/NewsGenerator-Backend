//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: pool.mjs
//  Description: Step 1 of the map of the FIFA presidency: the passages to label (the gold set) out of the census files. Kept: EVERY passage
//               of a member association; of a confederation, the passages with a word of support or opposition (the others name it
//               next to the person with no stance: "UEFA president Ceferin met Infantino"), the same sentence of the same
//               confederation written in several stories counted once with all its news. Split in two halves, "dev" (where the
//               pipeline is tuned) and "test" (sealed: read once, at the end), by group association x person: the same association
//               talking of the same person comes in many near copies, and a copy on each side would let the test see what the
//               tuning saw. The split is the one of the 60 seeds that balances the halves best. Read-only
//
//  node bench/fifa/pool.mjs
//

import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';

const data = (name) => new URL(`./data/${name}`, import.meta.url);
const SUBJECTS = ['infantino', 'tashima', 'wenger', 'vega'];
const norm = (text) => String(text ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim();

const all = SUBJECTS.flatMap(regex => JSON.parse(readFileSync(data(`census-${regex}.json`), 'utf8')).passages);
const kept = all.filter(p => p.member.level === 'association' || p.stanceWords.support || p.stanceWords.oppose);

// the same sentence of the same confederation in several stories: one passage, all the news
const merged = new Map();
for (const p of kept) {
    const key = p.member.level === 'confederation' ? `${p.subject.regex}|${p.member.qid}|${norm(p.sentence)}` : p.id;
    const found = merged.get(key);
    if (!found) merged.set(key, {...p, also: []});
    else {
        found.news += p.news;
        found.media = Math.max(found.media, p.media);
        found.also.push(p.article.id);
    }
}
const group = (p) => `${p.member.fifa}|${p.subject.regex}`;

// A group (an association talking of a person) holds near copies of the same agency text: 15 passages at most, chosen to differ (media,
// language, week, the way the sentence starts), the ones with a word of stance and the hard ones (a name found in the text only, a bare
// acronym) first. The census has the numbers (groupSize says how many the group had); no weight is applied, the gold set is for finding
// the errors of every kind, and the production precision is read on the live audit (scripts/fifa-audit.js)
const CAP = 15;
const week = (date) => Math.floor(new Date(date).getTime() / (7 * 864e5));
const diverse = (list, cap) => {
    const rest = [...list].sort((a, b) => a.id.localeCompare(b.id));
    const chosen = [];
    const seen = {medium: new Set(), lang: new Set(), week: new Set(), head: new Set()};
    while (chosen.length < cap && rest.length > 0) {
        let at = 0, top = -1;
        rest.forEach((p, i) => {
            const score = (seen.medium.has(p.article.medium) ? 0 : 1) + (seen.lang.has(p.article.lang) ? 0 : 1) + (seen.week.has(week(p.article.date)) ? 0 : 1)
                + (seen.head.has(norm(p.sentence).slice(0, 40)) ? 0 : 2) + (p.stanceWords.support || p.stanceWords.oppose ? 0.5 : 0) + (p.bound === 'loose' || p.acronymOnly ? 0.5 : 0);
            if (score > top) { top = score; at = i; }
        });
        const [p] = rest.splice(at, 1);
        chosen.push(p);
        seen.medium.add(p.article.medium); seen.lang.add(p.article.lang); seen.week.add(week(p.article.date)); seen.head.add(norm(p.sentence).slice(0, 40));
    }
    return chosen;
};
const pool = Object.values(Object.groupBy([...merged.values()], group)).flatMap(list => diverse(list, CAP).map(p => ({...p, groupSize: list.length})))
    .sort((a, b) => a.id.localeCompare(b.id));

const groups = Object.entries(Object.groupBy(pool, group)).map(([key, list]) => ({key, size: list.length}));
const sideOf = (seed, key) => parseInt(createHash('sha1').update(`${seed}|${key}`).digest('hex').slice(0, 8), 16) % 2 === 0 ? 'dev' : 'test';
let best = null;
for (let seed = 0; seed < 60; seed++) {
    const size = {dev: 0, test: 0, devAssoc: 0, testAssoc: 0};
    for (const g of groups) {
        const side = sideOf(seed, g.key);
        size[side] += g.size;
    }
    const gap = Math.abs(size.dev - size.test);
    if (!best || gap < best.gap) best = {seed, gap, size};
}
for (const p of pool) p.split = sideOf(best.seed, group(p));
const count = (f) => pool.filter(f).length;
console.log(`census ${all.length} passages -> pool ${pool.length} (${count(p => p.member.level === 'association')} of associations, ${count(p => p.member.level === 'confederation')} of confederations)`);
console.log(`split seed ${best.seed}: dev ${count(p => p.split === 'dev')}, test ${count(p => p.split === 'test')}; groups ${groups.length}`);
console.log('per person:', SUBJECTS.map(r => `${r} ${count(p => p.subject.regex === r)}`).join(', '));
console.log('largest groups:', groups.sort((a, b) => b.size - a.size).slice(0, 8).map(g => `${g.key} ${g.size} (${sideOf(best.seed, g.key)})`).join(', '));
writeFileSync(data('pool.json'), JSON.stringify({made: new Date().toISOString(), seed: best.seed, passages: pool}, null, 1));
console.log('written bench/fifa/data/pool.json');
