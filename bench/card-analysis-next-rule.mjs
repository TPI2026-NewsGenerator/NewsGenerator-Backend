// A code rule tried on the judged "next" lines (no AI): keep a next line only when one of its cited
// sentences holds a word of the future or of a condition (will, could, if, deadline, appeal, vote...)
//   node bench/card-analysis-next-rule.mjs  (reads checked-*.json, tally.json, judge verdicts)
import fs from 'node:fs';

const DIR = new URL('./data/card-analysis/', import.meta.url);
const briefings = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('cards.json', DIR), 'utf8')).map(b => [b.id, b]));
const {flagged} = JSON.parse(fs.readFileSync(new URL('tally.json', DIR), 'utf8'));
const bad = new Set(flagged.map(f => `${f.file}|${f.card}|${f.text}`));
const FUTURE = /\b(will|would|could|may|might|shall|expected|plans?|deadline|appeal|vote|ruling|verdict|hearing|next|upcoming|if|unless|threat\w*|warn\w*|risk\w*|must|pourr?\w*|devr\w*|sera\w*|aur\w*|ira\w*|prochain\w*|si|menace\w*|risque\w*|appel|vote|échéance|délai|podría|deberá|será|podrá|si|vil|skal|kan|kommer|wird|könnte|soll)\b|\w+(ra|rai|ront|rait|raient|rá|rán)\b/i;
const out = {};
for (const file of fs.readdirSync(DIR).filter(f => /^checked-.*\.json$/.test(f))) {
    const t = out[file] = {next: 0, bad: 0, keptByRule: 0, badKeptByRule: 0};
    for (const l of JSON.parse(fs.readFileSync(new URL(file, DIR), 'utf8')).filter(l => l.kept && l.part === 'next')) {
        const card = briefings[l.briefing].cards[l.card - 1];
        const sentence = (id) => { const m = id.match(/^A(\d+) s(\d+)$/); return m ? card.articles[m[1] - 1]?.sentences[m[2] - 1] ?? '' : ''; };
        const isBad = bad.has(`${file.replace(/^checked-/, 'analysis-')}|${l.briefing}-${l.card}|${l.raw}`);
        const keep = l.valid.some(id => FUTURE.test(sentence(id)));
        t.next++; if (isBad) t.bad++;
        if (keep) { t.keptByRule++; if (isBad) t.badKeptByRule++; }
    }
}
console.log(out);
