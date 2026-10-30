// What a word alone would be on a card with no link of its own: the person the card logic of
// withSurnamesLinked (card-names.js) gives it, the one linked person whose name ends with it, met 3 times more
// than any other (MentionModel.personsEndingWith). Against truth.json: of the right ones, how many get the same
// item back (recovered), another or none (lost); of the wrong ones, how many get another item (to read) or
// none (no wrong link left). node --env-file=.env bench/single-words/surnames.mjs
import fs from 'node:fs';
import {MentionModel} from '../../models/mention-model.js';
import {mentionKey} from '../../services/utils/mentions.js';
import {describeItems} from '../../services/utils/wikidata.js';
import {prisma} from '../../config/db.js';

const read = (file) => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const sample = read('./sample.json');
const truth = read('./truth.json');
const AHEAD = 3;
const words = sample.map(e => mentionKey(e.name)).filter(key => key.length >= 4 && !key.includes(' '));
const rows = await MentionModel.personsEndingWith([...new Set(words)]);
const byWord = new Map();
for (const row of rows) byWord.set(row.word, [...(byWord.get(row.word) ?? []), row]);
const results = [];
const tally = {R: {same: 0, other: 0, none: 0}, W: {other: 0, none: 0}};
const others = [];
for (const [i, e] of sample.entries()) {
    if (truth[i] === '?') continue;
    const key = mentionKey(e.name);
    const [first, second] = key.length >= 4 && !key.includes(' ') ? byWord.get(key) ?? [] : [];
    const found = first && first.seen >= AHEAD * (second?.seen ?? 0) ? first : null;
    results[i] = found ? found.qid : null;
    if (truth[i] === 'R') tally.R[!found ? 'none' : found.qid === e.qid ? 'same' : 'other']++;
    else tally.W[found ? 'other' : 'none']++;
    if (found && found.qid !== e.qid) others.push({i, truth: truth[i], e, found});
}
fs.writeFileSync(new URL('./surnames.json', import.meta.url), JSON.stringify(results));
console.log(JSON.stringify(tally));
const labels = new Map();
for (let i = 0; i < others.length; i += 10) for (const item of await describeItems(others.slice(i, i + 10).map(o => o.found.qid))) labels.set(item.qid, item);
for (const o of others) console.log(`${o.truth}\t${o.e.name} [now ${o.e.label}: ${o.e.description.slice(0, 40)}] -> ${labels.get(o.found.qid)?.label} (${(labels.get(o.found.qid)?.description ?? '').slice(0, 50)}) seen ${o.found.seen}`);
await prisma.$disconnect();
