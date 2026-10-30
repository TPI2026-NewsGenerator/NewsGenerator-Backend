// The labels by hand of bench/data/other-angles.txt (other-angles-labels.json) counted: what each
// rule would show, how much of it is another angle of the card's affair
//   node bench/other-angles-score.mjs
import fs from 'node:fs';
const text = fs.readFileSync(new URL('./data/other-angles.txt', import.meta.url), 'utf8');
const labels = JSON.parse(fs.readFileSync(new URL('./data/other-angles-labels.json', import.meta.url), 'utf8'));
const rows = [];
let card = null;
for (const line of text.split('\n')) {
    const head = line.match(/^#(\d+) \[p(\d+) (\w+)/);
    if (head) { card = {id: head[1], profile: head[2], lang: head[3], i: 0}; continue; }
    const row = line.match(/^ {2}([AB]) ([\d.]+) (\w+) /);
    if (!row || !card) continue;
    const label = labels[card.profile]?.[card.id]?.[card.i++];
    if (!label) throw new Error(`no label for #${card.id} line ${card.i}`);
    rows.push({card: card.id, profile: card.profile, method: row[1], likeness: Number(row[2]), across: row[3] !== card.lang, label});
}
for (const [id, l] of Object.entries({...labels['7'], ...labels['8']})) if (id !== '_' && rows.filter(r => r.card === id).length !== l.length) throw new Error(`count #${id}`);
const count = (list) => Object.fromEntries(['G', 'S', 'T', 'W'].map(k => [k, list.filter(r => r.label === k).length]));
const cards = (list) => new Set(list.filter(r => r.label === 'G').map(r => r.card)).size;
const say = (name, list) => { const c = count(list); console.log(`${name.padEnd(46)} ${String(list.length).padStart(3)} shown  G ${c.G} S ${c.S} T ${c.T} W ${c.W}  precision ${(100 * c.G / (list.length || 1)).toFixed(0)}%  cards with a G ${cards(list)}`); };
for (const p of ['7', '8']) {
    const mine = rows.filter(r => r.profile === p);
    say(`profile ${p} all`, mine);
    say(`profile ${p} A thread`, mine.filter(r => r.method === 'A'));
    say(`profile ${p} B close`, mine.filter(r => r.method === 'B'));
    // the versions in another language the card already joins (acrossOf, 0.78) left out
    for (const lo of [0.65, 0.70, 0.72, 0.75]) {
        say(`profile ${p} >= ${lo}, no other-language >= 0.78`, mine.filter(r => r.likeness >= lo && !(r.across && r.likeness >= 0.78)));
    }
}
