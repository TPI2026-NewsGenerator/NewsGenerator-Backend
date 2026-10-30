// Blind judging packets of the analysis bench: node bench/analysis-judge.mjs
//   reads data/analysis/checked-*.json, writes data/analysis/judge/packet-<briefing>.md (cards, then
//   every line of every run, models hidden, the same text of one card said once) and judge/key.json
//   (line id -> the runs that wrote it, its checks). Lines dropped by the checks are judged too (to
//   tell whether the checks dropped right), the judge does not know which.
import fs from 'node:fs';

const DIR = new URL('./data/analysis/', import.meta.url);
const OUT = new URL('./judge/', DIR);
fs.mkdirSync(OUT, {recursive: true});
const briefings = JSON.parse(fs.readFileSync(new URL('briefings.json', DIR), 'utf8'));
const files = fs.readdirSync(DIR).filter(f => /^checked-.*\.json$/.test(f));
const lines = files.flatMap(f => JSON.parse(fs.readFileSync(new URL(f, DIR), 'utf8')).map(l => ({...l, run: f.replace(/^checked-|\.json$/g, '')})));

// a fixed shuffle, the same each time the packets are made
let seed = 20261015;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const shuffle = (list) => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
};

const key = {};
for (const b of briefings) {
    const mine = lines.filter(l => l.id === b.id);
    // one entry per (part, cards, text): runs that wrote the same line share it
    const unique = new Map();
    for (const l of mine) {
        const k = `${l.part}|${[...l.cards].sort((x, y) => x - y)}|${l.text.trim()}`;
        if (!unique.has(k)) unique.set(k, {part: l.part, cards: l.cards, text: l.text.trim(), runs: []});
        unique.get(k).runs.push({run: l.run, kept: l.kept, reasons: l.reasons, figuresMissing: l.figuresMissing, namesMissing: l.namesMissing});
    }
    let n = 0;
    const entries = shuffle([...unique.values()]).map(e => ({...e, lid: `b${b.id}-${String(++n).padStart(3, '0')}`}));
    for (const e of entries) key[e.lid] = e;
    const card = (c) => `### Card ${c.n} (${c.medium})
Title: ${c.title}${c.titleTranslation ? `\nTitle translated: ${c.titleTranslation}` : ''}
Key passages${c.translation ? ' (translated for the reader)' : ''}:
${(c.translation ?? c.passages).replace(/\n{2,}/g, '\n')}`;
    const changed = b.cards.map(c => {
        const own = entries.filter(e => e.part === 'changed' && e.cards.length === 1 && e.cards[0] === c.n);
        return `${card(c)}

"What changed" lines written for card ${c.n}:
${own.length ? own.map(e => `- ${e.lid}: ${e.text}`).join('\n') : '(none)'}`;
    }).join('\n\n');
    const others = entries.filter(e => e.part === 'changed' && !(e.cards.length === 1 && b.cards[e.cards[0] - 1]));
    const list = (part) => entries.filter(e => e.part === part).map(e => `- ${e.lid} [cites cards ${e.cards.join(', ') || 'none'}]: ${e.text}`).join('\n') || '(none)';
    fs.writeFileSync(new URL(`packet-${b.id}.md`, OUT), `# Briefing ${b.id}: ${b.kind}. Reader language: ${b.language}. ${b.cards.length} cards.

## The cards (the ONLY information the writers had), each followed by its "What changed" lines

${changed}
${others.length ? `\n## "What changed" lines citing another card or several\n${others.map(e => `- ${e.lid} [cites cards ${e.cards.join(', ') || 'none'}]: ${e.text}`).join('\n')}\n` : ''}
## "Why this matters (the system)" lines: a link between at least 3 cards
${list('system')}

## "What breaks next (forward risk)" lines, written "X → Y" (if X, then Y)
${list('risk')}
`);
    console.log(`${b.id}: ${entries.length} lines to judge (${mine.length} written)`);
}
fs.writeFileSync(new URL('key.json', OUT), JSON.stringify(key, null, 1));
