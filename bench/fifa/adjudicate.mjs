//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: adjudicate.mjs
//  Description: From the three labellers to the gold set of the map of the FIFA presidency: how much they agree (Cohen's kappa on the status,
//               the agreement on every field), the label of each passage by majority, and the queue of the passages that need a
//               human: the three labels all differ, or the majority says "established" with one labeller against it (a wrong
//               "established" is the error that costs: it is a colour on the map). The decisions of the user are written to
//               data/decisions.json ({"<id>": "established|uncertain|discarded"}) and win over the labellers.
//
//  node bench/fifa/adjudicate.mjs        writes data/gold.json and data/adjudication-queue.md
//

import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {BATCHES, BINDING, dataFile} from './labels.mjs';

const NAMES = ['A', 'B', 'C'];
const pool = JSON.parse(readFileSync(dataFile('pool.json'), 'utf8')).passages;
const byId = new Map(pool.map(p => [p.id, p]));
const labels = {};
for (const name of NAMES) {
    labels[name] = new Map();
    for (let n = 1; n <= BATCHES; n++) {
        const file = dataFile(`labels-${name}-${n}.json`);
        if (!existsSync(file)) continue;
        for (const label of JSON.parse(readFileSync(file, 'utf8'))) labels[name].set(label.id, label);
    }
}
console.log('labels:', NAMES.map(name => `${name} ${labels[name].size}`).join(', '), `of ${pool.length} passages`);

// ---- agreement
const kappa = (a, b, field) => {
    const ids = [...a.keys()].filter(id => b.has(id));
    if (ids.length === 0) return null;
    const classes = [...new Set(ids.flatMap(id => [a.get(id)[field], b.get(id)[field]]))];
    const observed = ids.filter(id => a.get(id)[field] === b.get(id)[field]).length / ids.length;
    const expected = classes.reduce((sum, c) => sum + (ids.filter(id => a.get(id)[field] === c).length / ids.length) * (ids.filter(id => b.get(id)[field] === c).length / ids.length), 0);
    return {n: ids.length, agree: observed, kappa: expected === 1 ? 1 : (observed - expected) / (1 - expected)};
};
const pct = (x) => `${(100 * x).toFixed(0)}%`;
for (const [x, y] of [['A', 'B'], ['A', 'C'], ['B', 'C']]) {
    const line = ['status', 'association_ok', 'about_election', 'stance', 'speaker_kind'].map(field => {
        const k = kappa(labels[x], labels[y], field);
        return k ? `${field} ${pct(k.agree)} (k ${k.kappa.toFixed(2)})` : `${field} -`;
    });
    // level, among the passages both call established
    const both = [...labels[x].keys()].filter(id => labels[y].has(id) && labels[x].get(id).status === 'established' && labels[y].get(id).status === 'established');
    const sameLevel = both.filter(id => labels[x].get(id).level === labels[y].get(id).level).length;
    console.log(`${x}-${y}: ${line.join(' | ')} | level among both-established ${sameLevel}/${both.length}${both.length ? ` (${pct(sameLevel / both.length)})` : ''}`);
}

// ---- majority and queue
const decisions = existsSync(dataFile('decisions.json')) ? JSON.parse(readFileSync(dataFile('decisions.json'), 'utf8')) : {};
const mode = (values) => {
    const counts = new Map();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    const [top, second] = [...counts].sort((a, b) => b[1] - a[1]);
    return top && (!second || top[1] > second[1]) ? top[0] : null;
};
const gold = [], queue = [], migrations = [];
for (const p of pool) {
    const given = NAMES.map(name => labels[name].get(p.id)).filter(Boolean);
    if (given.length === 0) continue;
    const statuses = given.map(l => l.status);
    const majority = given.length >= 2 ? mode(statuses) : null;
    const dissent = majority ? given.filter(l => l.status !== majority) : given;
    // a decision is a status, or {status, stance, level, reason}: what a human gives wins over the labellers
    const raw = decisions[p.id] ?? null;
    const decided = raw === null ? null : typeof raw === 'string' ? raw : raw.status;
    const status = decided ?? majority;
    const agreeing = given.filter(l => l.status === status);
    const field = (name) => (typeof raw === 'object' && raw?.[name] !== undefined ? raw[name] : null) ?? mode(agreeing.map(l => l[name])) ?? agreeing[0]?.[name] ?? null;
    // Rule 10 of the guide (decided by the user on 12.11.2026, after the labelling): the criticism of the conduct of the FIFA president by a bound speaker
    // is an established stance against, probable, even with no word of the election. The labellers had discarded it as "not about the election":
    // when a passage was discarded only for that (the association right, a bound speaker, against, toward the person, official), it becomes
    // established. Listed in data/rule10-migration.txt to be read
    const conduct = (l) => l.association_ok === 'yes' && l.about_election === false && BINDING.has(l.speaker_kind) && l.stance === 'against' && l.toward === 'person' && l.mark === 'official';
    // two voices at least: a labeller who read it as conduct criticism, and another who called it established or read it so too
    const migrated = decided === null && status === 'discarded' && !given.some(l => l.association_ok === 'no')
        && given.filter(conduct).length + given.filter(l => l.status === 'established').length >= 2;
    const needsHuman = decided === null && (majority === null || (majority === 'established' && dissent.length > 0) || (majority !== 'established' && dissent.some(l => l.status === 'established') && given.length === 3 && dissent.length === 2));
    if (needsHuman) queue.push({p, given});
    if (migrated) migrations.push(`${p.id} ${p.member.fifa} on ${p.subject.regex} [${given.map(l => l.status).join('/')}] ${p.sentence.replace(/\s+/g, ' ').slice(0, 200)}`);
    gold.push({
        id: p.id, split: p.split, subject: p.subject.regex, member: p.member.fifa, status: migrated ? 'established' : status,
        level: migrated ? 'probable' : status === 'established' ? field('level') : 'none', reason: !migrated && status === 'uncertain' ? field('reason') : '',
        association_ok: field('association_ok'), about_election: migrated ? true : field('about_election'), stance: migrated ? 'against' : field('stance'), speaker_kind: field('speaker_kind'), migrated,
        agreement: decided ? 'human' : `${agreeing.length}/${given.length}`, needsHuman, labels: Object.fromEntries(NAMES.map(name => [name, labels[name].get(p.id)?.status ?? null])),
    });
}
// the same sentence of the same association on the same person in several stories (the agency paragraph "KNVB and UEFA withdrew their
// confidence" is in four stories of one newspaper) is one passage for the score: the first by id stands, the others are not scored
const firstOf = new Map();
for (const g of gold) {
    const p = byId.get(g.id);
    const key = `${p.subject.regex}|${p.member.qid}|${p.sentence.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()}`;
    if (firstOf.has(key)) g.duplicateOf = firstOf.get(key);
    else firstOf.set(key, g.id);
}
writeFileSync(dataFile('gold.json'), JSON.stringify(gold, null, 1));
console.log(`duplicates of a sentence already in the set (not scored): ${gold.filter(g => g.duplicateOf).length}`);
writeFileSync(dataFile('rule10-migration.txt'), migrations.join('\n'));
console.log(`rule 10 migration: ${migrations.length} passages discarded by the labellers only as "not about the election" became established against (data/rule10-migration.txt)`);
const count = (f) => gold.filter(f).length;
console.log(`gold: ${gold.length} passages | established ${count(g => g.status === 'established')}, uncertain ${count(g => g.status === 'uncertain')}, discarded ${count(g => g.status === 'discarded')}, undecided ${count(g => !g.status)}`);
console.log(`agreement: 3/3 ${count(g => g.agreement === '3/3')}, 2/3 ${count(g => g.agreement === '2/3')}, human ${count(g => g.agreement === 'human')}, none ${count(g => g.agreement === '1/3' || g.agreement === '1/2')}`);
const established = gold.filter(g => g.status === 'established');
console.log(`established: declared ${established.filter(g => g.level === 'declared').length}, probable ${established.filter(g => g.level === 'probable').length}; sides for ${established.filter(g => g.stance === 'for').length}, against ${established.filter(g => g.stance === 'against').length}`);
console.log(`uncertain by reason: ${Object.entries(Object.groupBy(gold.filter(g => g.status === 'uncertain'), g => g.reason)).map(([r, l]) => `${r || '-'} ${l.length}`).join(', ')}`);
console.log(`to the user: ${queue.length} passages`);

const lines = ['# Passages to decide', '', 'Answer with the id and E (established: a colour), U (uncertain: badge, no colour) or D (discarded: wrong association or not about the election). Rules: services/utils/fifa-guide.md.', ''];
queue.forEach(({p, given}, i) => {
    lines.push(`## ${i + 1}. ${p.id} - ${p.member.name} (${p.member.fifa}) on ${p.subject.name}`);
    lines.push(`- ${p.article.medium}, ${p.article.lang}, ${p.article.date}: ${p.article.title}`);
    lines.push(`- Sentence: ${p.sentence.replace(/\s+/g, ' ')}`);
    lines.push(`- Matched name: ${p.matched}`);
    lines.push(`- Labels: ${NAMES.map(name => { const l = labels[name].get(p.id); return l ? `${name}=${l.status}${l.reason ? `/${l.reason}` : ''}${l.status === 'established' ? `/${l.stance}/${l.level}` : ''}${l.note ? ` ("${l.note.slice(0, 90)}")` : ''}` : `${name}=-`; }).join(' ; ')}`);
    lines.push('');
});
writeFileSync(dataFile('adjudication-queue.md'), lines.join('\n'));
