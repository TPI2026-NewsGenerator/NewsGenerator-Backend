// The packets of the blind judging of the per-card analysis bench, read by Claude subagents:
//   node bench/card-analysis-judge.mjs triage   -> data/card-analysis/judge/triage-<n>.md
//     every card of 2-3 briefings, as the triage read it (+ its timeline titles): the judge says of
//     each card MERITS / BORDERLINE / PLAIN, without seeing any pick
//   node bench/card-analysis-judge.mjs lines [packets]  -> data/card-analysis/judge/lines-<n>.md + key.json
//     every analysed card with its sources and the versions of its analysis (one per run, shuffled,
//     V1.. with the model hidden): the judge says of each line whether its cited sources support it
//     and whether it helps, and of each version whether it is worth showing
//   round 2: JUDGE_DIR=judge-v2 JUDGE_FILES=analysis-...-on-1.json,analysis-...-on-v2.json JUDGE_SEED=2
import fs from 'node:fs';
import {nextText, shownText, sourcesText} from './card-analysis-prompt.mjs';

const [what = 'lines', packetsArg = '10'] = process.argv.slice(2);
const DIR = new URL('./data/card-analysis/', import.meta.url);
// JUDGE_DIR: another folder of packets and verdicts (judge-v2 for round 2); JUDGE_FILES: only these runs
const JUDGE = new URL(`${process.env.JUDGE_DIR ?? 'judge'}/`, DIR);
const onlyFiles = process.env.JUDGE_FILES?.split(',');
fs.mkdirSync(JUDGE, {recursive: true});
const briefings = JSON.parse(fs.readFileSync(new URL('cards.json', DIR), 'utf8'));
const byId = Object.fromEntries(briefings.map(b => [b.id, b]));

// a seeded shuffle: the same packets each time
let seed = Number(process.env.JUDGE_SEED ?? 20261015);
const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const shuffled = (list) => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
};

const seen = (card) => `Title: ${card.title}${card.titleTranslation ? `\nTitle translated: ${card.titleTranslation}` : ''}
Key passages${card.translation ? ' (translated)' : ''}:
${(card.translation ?? card.passages).replace(/\n{2,}/g, '\n')}`;

if (what === 'triage') {
    const groups = [[99, 90], [100], [94, 92, 59], [70], [29, 34, 31]];
    groups.forEach((ids, g) => {
        const text = ids.map(id => {
            const b = byId[id];
            return `# Briefing ${id} (${b.kind}), reader language ${b.language}\n\n` + b.cards.map(card => `## Card ${id}-${card.n} (${card.medium})
${seen(card)}
Earlier stories of the same affair: ${card.timeline.items.length ? '\n' + card.timeline.items.map(t => `- ${t.date} ${t.titleTranslation ?? t.title}`).join('\n') : 'none found'}`).join('\n\n');
        }).join('\n\n');
        fs.writeFileSync(new URL(`triage-${g + 1}.md`, JUDGE), text);
    });
    console.log(`${groups.length} triage packets`);
} else {
    const runs = fs.readdirSync(DIR).filter(f => /^analysis-.*\.json$/.test(f) && !f.includes('.try') && (!onlyFiles || onlyFiles.includes(f)));
    const answers = {};
    for (const file of runs) {
        const {results} = JSON.parse(fs.readFileSync(new URL(file, DIR), 'utf8'));
        for (const r of results) (answers[`${r.briefing}-${r.card}`] ??= []).push({file, json: r.error ? null : r.json, error: r.error});
    }
    const key = {};
    const cards = Object.keys(answers).sort((a, b) => a.localeCompare(b, 'en', {numeric: true}));
    const packets = Number(packetsArg);
    const texts = Array.from({length: packets}, () => []);
    cards.forEach((cardKey, i) => {
        const [id, n] = cardKey.split('-').map(Number);
        const card = byId[id].cards[n - 1];
        const versions = shuffled(answers[cardKey]);
        key[cardKey] = Object.fromEntries(versions.map((v, k) => [`V${k + 1}`, v.file]));
        const list = (items) => Array.isArray(items) ? items : [];
        const versionsText = versions.map((v, k) => {
            if (!v.json) return `### V${k + 1}\n(no answer)`;
            // the lines as shown (SHOWN=1: ids in the text swapped for the medium, round 3)
            const shown = (text) => process.env.SHOWN ? shownText(card, text) : text;
            const lines = [...list(v.json.why).map(l => `[why] ${shown(l?.text ?? '')}`), ...list(v.json.next).map(l => `[next] If ${shown(nextText(l)).replace(' → ', ' → then ')}`)];
            const cites = [...list(v.json.why), ...list(v.json.next)].map(l => (Array.isArray(l?.cites) ? l.cites : [l?.cites]).filter(Boolean).join(', '));
            return `### V${k + 1}\n${lines.length ? lines.map((l, j) => `${j + 1}. ${l}\n   cites: ${cites[j] || '(none)'}`).join('\n') : '(empty: no analysis)'}`;
        }).join('\n\n');
        texts[i % packets].push(`## Card ${cardKey} (briefing ${id}, ${byId[id].kind}; analysis written in ${byId[id].language})

THE CARD THE READER SEES
${seen(card)}

SOURCES (what the analysis could use; ids: A1 s12 = article 1 sentence 12, T = timeline, G = other angle, D = denial, O = official source, W = Wikidata)

${sourcesText(card)}

VERSIONS OF THE ANALYSIS

${versionsText}`);
    });
    texts.forEach((t, i) => fs.writeFileSync(new URL(`lines-${i + 1}.md`, JUDGE), t.join('\n\n---\n\n')));
    fs.writeFileSync(new URL('key.json', JUDGE), JSON.stringify(key, null, 1));
    console.log(`${cards.length} cards in ${packets} packets, sizes ${texts.map(t => Math.round(t.join('').length / 1000) + 'k').join(' ')}`);
}
