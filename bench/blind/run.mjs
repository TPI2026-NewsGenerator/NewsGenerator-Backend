// The systems on the blind items (items.json), whose answers were judged beforehand (truth.json): what each picks
// among the candidates of a name, or none. Systems:
//   plain    the AI reads the titles of the card and the candidates (what organizationItem asks, for any kind)
//   rich     the same with what else the card says: its topic, the other names on it, the countries of its sites
//   ordered  rich, the candidates by their number of Wikipedias (the most known first) instead of a mixed order
//   rich2    rich, and for a person: only when the role and country of the item fit the card, a namesake is none
//   vote     rich, three orders (mixed differently each time) and the answer given at least twice, else none
// Writes results-<system>.json: [{i, pick (qid | null), raw}]. node --env-file=.env bench/blind/run.mjs <system> [from] [to]
import fs from 'node:fs';
import {ollamaJson, newUsage} from '../../services/utils/ollama.js';

const system = process.argv[2];
if (!['plain', 'rich', 'ordered', 'vote', 'rich2'].includes(system)) throw new Error('system: plain, rich, ordered or vote');
const items = JSON.parse(fs.readFileSync(new URL('./items.json', import.meta.url), 'utf8'));
const from = Number(process.argv[3] ?? 0);
const to = Number(process.argv[4] ?? items.length);
const regions = new Intl.DisplayNames(['en'], {type: 'region'});
const countryName = (code) => { try { return regions.of(code) ?? code; } catch { return code; } };

const seeded = (seed) => () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffled = (list, random) => list.map(item => [random(), item]).sort((a, b) => a[0] - b[0]).map(([, item]) => item);

const NAMESAKE = 'For a person: only when what the item says of them (their job, their country) fits the card; a namesake of another job or another country is none (0). ';
const prompt = (item, candidates, rich, namesake = false) => `A name in the news: "${item.name}" (${item.kind}).

Titles of news naming it:
${item.titles.map(title => `- ${title}`).join('\n')}
${rich ? `
The card these news make is about: ${item.topic ?? 'unknown'}.
Other names on the card: ${item.others.join(', ') || 'none'}.
Countries of the sites that published the news: ${Object.entries(item.sites).sort((a, b) => b[1] - a[1]).map(([code, n]) => `${countryName(code)} (${n})`).join(', ') || 'unknown'}.
` : ''}
Items of Wikidata called so or near:
${candidates.map((c, i) => `[${i + 1}] ${c.label}: ${c.description || '(no description)'} (${c.links} Wikipedias)`).join('\n')}

Which item is the "${item.name}" these news name? ${rich ? 'Use what the card is about and the other names: a name on a sports card is the club, not the city of the same name. ' : ''}${namesake ? NAMESAKE : ''}Only when you are sure from the titles: a person, a club, a league, a body these news are about. 0 when none of them is, when you cannot tell, or when the name is only a part of many names ("FC", "Club", "United").
Answer in JSON only: {"n": 0}`;

const ask = async (item, candidates, rich, usage, namesake = false) => {
    if (candidates.length === 0) return {pick: null, n: 0};
    const answer = await ollamaJson(prompt(item, candidates, rich, namesake), usage);
    const n = Number(answer?.n);
    return {pick: Number.isInteger(n) && n >= 1 && n <= candidates.length ? candidates[n - 1].qid : null, n};
};

const decide = async (item, usage) => {
    if (system === 'plain') return ask(item, item.candidates, false, usage);
    if (system === 'rich') return ask(item, item.candidates, true, usage);
    if (system === 'rich2') return ask(item, item.candidates, true, usage, true);
    if (system === 'ordered') return ask(item, [...item.candidates].sort((a, b) => b.links - a.links), true, usage);
    const answers = [];
    for (const seed of [1, 2, 3]) answers.push((await ask(item, shuffled(item.candidates, seeded(item.i * 10 + seed)), true, usage)).pick);
    const counts = new Map();
    for (const qid of answers.filter(Boolean)) counts.set(qid, (counts.get(qid) ?? 0) + 1);
    const [best] = [...counts].sort((a, b) => b[1] - a[1]);
    return {pick: best && best[1] >= 2 ? best[0] : null, answers};
};

const usage = newUsage();
const out = new Array(items.length);
let next = from;
const worker = async () => {
    for (;;) {
        const k = next++;
        if (k >= to) return;
        try {
            const result = await decide(items[k], usage);
            out[k] = {i: k, pick: result.pick, raw: result.answers ?? result.n};
        } catch (err) {
            out[k] = {i: k, pick: null, raw: `error: ${err.message}`};
        }
    }
};
await Promise.all([worker(), worker(), worker(), worker()]);
const done = out.filter(Boolean);
fs.writeFileSync(new URL(`./results-${system}.json`, import.meta.url), JSON.stringify(done));
console.log(`${system}: ${done.length} names, ${done.filter(r => String(r.raw).startsWith('error')).length} errors, tokens ${JSON.stringify(usage)}`);
