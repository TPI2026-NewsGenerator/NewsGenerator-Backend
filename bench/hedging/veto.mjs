//
//  Author: Fabian Rostello
//  Date: 11.11.2026
//  File: veto.mjs
//  Description: Measures an AI VETO on the mark "Reported" of the affairs (the user, 11.11.2026: step 2, after the words of hedging.js were measured and
//               corrected): of the news the words call hedged, how many does the AI (gemma4:31b, the model of the project) say are told as a fact,
//               and are they the right ones? Also the AI alone, and the AI added to the words, on news the words do NOT mark (what the words miss).
//               The truth is the label of two blind judges (agents that never see what the words said), kept when both agree.
//
//               The AI reads what the words read, the title and the beginning of the text; the variant 'title' reads the title only, as judgeStories
//               (affair-judge.js) does today.
//
//  node --env-file=.env bench/hedging/veto.mjs build           the news to judge: bench/data/hedging/dataset.json, and the blind chunks in judge/
//  node --env-file=.env bench/hedging/veto.mjs run <variant>   title | desc | think : the answers of the AI in out-<variant>.json
//  node --env-file=.env bench/hedging/veto.mjs score           the labels of the judges (labels-<judge>-<chunk>.json) against the words and the AI
//

import process from 'node:process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {prisma} from '../../config/db.js';
import {hedgedBy} from '../../services/utils/hedging.js';
import {newUsage, ollamaJson} from '../../services/utils/ollama.js';

const DIR = 'bench/data/hedging';
const SHOWN = 600;          // characters of the text shown to the judges and to the AI (the words read the same ones)
const AT_ONCE = 15;         // news in one call
const CALLS_AT_ONCE = 3;
const DAYS = 14;

// what the sample holds, by group of languages: news the words mark, news they do not
const GROUPS = [
    {name: 'en', langs: ['en'], marked: 36, unmarked: 60},
    {name: 'es', langs: ['es'], marked: 12, unmarked: 24},
    {name: 'fr', langs: ['fr'], marked: 18, unmarked: 30},
    {name: 'de', langs: ['de'], marked: 18, unmarked: 24},
    {name: 'it', langs: ['it'], marked: 12, unmarked: 18},
    {name: 'pt', langs: ['pt'], marked: 12, unmarked: 18},
    {name: 'el', langs: ['el'], marked: 12, unmarked: 12},
    {name: 'nl', langs: ['nl'], marked: 8, unmarked: 8},
    {name: 'hr-sr-bs', langs: ['hr', 'sr', 'bs'], marked: 16, unmarked: 16},
    {name: 'ar', langs: ['ar'], marked: 8, unmarked: 8},
    {name: 'tr', langs: ['tr'], marked: 4, unmarked: 4},
    {name: 'pl', langs: ['pl'], marked: 4, unmarked: 4},
    {name: 'ko', langs: ['ko'], marked: 4, unmarked: 4},
    {name: 'sq', langs: ['sq'], marked: 4, unmarked: 4},
];

// the news of 14 days of the database and the ones the words mark, by group (bench/hedging/coverage.mjs of 11.11.2026, after the new words)
const NATURAL = {
    en: {news: 766242, marked: 12466}, es: {news: 309824, marked: 995}, fr: {news: 210620, marked: 1391}, de: {news: 116736, marked: 912},
    it: {news: 145016, marked: 341}, pt: {news: 88569, marked: 265}, el: {news: 62225, marked: 367}, nl: {news: 35047, marked: 187},
    'hr-sr-bs': {news: 69991, marked: 501}, ar: {news: 27647, marked: 139}, tr: {news: 6009, marked: 59}, pl: {news: 9785, marked: 90},
    ko: {news: 4901, marked: 58}, sq: {news: 11419, marked: 275},
};

// a seeded random, the same news every run
const seeded = (seed) => () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffled = (list, random) => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
};
const squash = (text) => String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const cut = (text, n) => text.length <= n ? text : `${text.slice(0, n).replace(/\s+\S*$/, '')}…`;
const read = (name) => JSON.parse(readFileSync(`${DIR}/${name}`, 'utf8'));
const write = (name, data) => writeFileSync(`${DIR}/${name}`, JSON.stringify(data, null, 1));

// ---- build
const build = async () => {
    mkdirSync(`${DIR}/judge`, {recursive: true});
    const random = seeded(11112026);
    const items = [];
    for (const group of GROUPS) {
        const rows = await prisma.$queryRawUnsafe(
            `SELECT id, lang, title, description FROM articles
             WHERE COALESCE(published_at, created_at) >= now() - ($1 || ' days')::interval AND lang = ANY($2::text[]) AND title IS NOT NULL
             ORDER BY random() LIMIT 6000`, String(DAYS), group.langs);
        const seen = new Set();
        const candidates = rows.map(row => {
            const title = squash(row.title);
            const description = cut(squash(row.description), SHOWN);
            return {articleId: row.id, lang: row.lang, title, description, words: hedgedBy(title, description)};
        }).filter(item => item.title.length > 12 && !seen.has(item.title) && seen.add(item.title));
        const marked = candidates.filter(item => item.words).slice(0, group.marked).map(item => ({...item, set: 'marked'}));
        const unmarked = candidates.filter(item => !item.words).slice(0, group.unmarked).map(item => ({...item, set: 'unmarked'}));
        console.log(`${group.name}: ${marked.length}/${group.marked} marked, ${unmarked.length}/${group.unmarked} unmarked`);
        items.push(...marked, ...unmarked);
    }
    const all = shuffled(items, random).map((item, i) => ({id: i + 1, ...item}));
    write('dataset.json', all);
    // the chunks the judges read: no word, no set, nothing that says what the words found
    const blind = all.map(({id, lang, title, description}) => ({id, lang, title, description}));
    const half = Math.ceil(blind.length / 2);
    write('judge/chunk-A.json', blind.slice(0, half));
    write('judge/chunk-B.json', blind.slice(half));
    console.log(`${all.length} news, ${all.filter(item => item.set === 'marked').length} marked by the words; chunks of ${half} in ${DIR}/judge/`);
};

// ---- the AI
// the definition the judges and the AI are given, the same
export const DEFINITION = `For each news (a title and the beginning of its text, in any language) say whether the article ITSELF presents the main thing it reports as UNCONFIRMED.
hedged = true when: the main claim rests on unnamed or unverifiable sources ("reportedly", "sources say", "according to sources close to the club", "según fuentes", "selon des sources", "σύμφωνα με πληροφορίες"), or the news IS a rumour or a speculation, or the article says that the fact is not confirmed.
hedged = false when the article states its news as a fact. In particular false for: a crime or court report where the arrest or the charge is stated and only the guilt is "alleged"; a rumour that the article denies, says is over or confirms; a word with another meaning (a noise, a speculation of a market, "unofficial" of a contest); information given by a named official source or a named medium and told as a fact; an opinion or an analysis.`;

const view = (item, withText) => `[${item.id}] (${item.lang}) ${item.title}${withText && item.description ? `\n    text: ${item.description}` : ''}`;
const prompt = (items, withText) => `${DEFINITION}

${items.map(item => view(item, withText)).join('\n\n')}

Answer only in JSON: {"cards": [{"id": number, "hedged": true or false}]}`;

const VARIANTS = {title: {text: false, think: undefined}, desc: {text: true, think: undefined}, think: {text: true, think: true}};

const run = async (variant) => {
    const config = VARIANTS[variant];
    if (!config) throw new Error(`variant: ${Object.keys(VARIANTS).join(' | ')}`);
    const items = read('dataset.json');
    const usage = newUsage();
    const answers = {};
    const chunks = Array.from({length: Math.ceil(items.length / AT_ONCE)}, (_, i) => items.slice(i * AT_ONCE, (i + 1) * AT_ONCE));
    const started = Date.now();
    let next = 0, failed = 0;
    const worker = async () => {
        while (next < chunks.length) {
            const chunk = chunks[next++];
            let answer = null;
            for (let attempt = 0; attempt < 2 && !answer; attempt++) {
                try {
                    answer = await ollamaJson(prompt(chunk, config.text), usage, {think: config.think, timeoutMs: 240e3});
                } catch (err) {
                    if (attempt === 1) { failed++; console.error(`a call failed: ${err.message}`); }
                }
            }
            for (const card of Array.isArray(answer?.cards) ? answer.cards : []) {
                if (chunk.some(item => item.id === Number(card?.id)) && typeof card.hedged === 'boolean') answers[Number(card.id)] = card.hedged;
            }
        }
    };
    await Promise.all(Array.from({length: CALLS_AT_ONCE}, worker));
    write(`out-${variant}.json`, answers);
    console.log(`${variant}: ${Object.keys(answers).length}/${items.length} answered in ${Math.round((Date.now() - started) / 1000)} s, ${chunks.length} calls (${failed} failed), tokens ${JSON.stringify(usage)}`);
};

// ---- score
const pct = (a, b) => b === 0 ? '  -  ' : `${(100 * a / b).toFixed(0).padStart(3)}%`;

const score = () => {
    const items = read('dataset.json');
    const labelsOf = (judge) => {
        const labels = {};
        for (const chunk of ['A', 'B']) {
            const file = `${DIR}/labels-${judge}-${chunk}.json`;
            if (!existsSync(file)) throw new Error(`missing: ${file}`);
            Object.assign(labels, JSON.parse(readFileSync(file, 'utf8')));
        }
        return labels;
    };
    const one = labelsOf(1), two = labelsOf(2);
    const truth = new Map();
    let agree = 0, both = 0;
    for (const item of items) {
        const a = Number(one[item.id] ?? 2), b = Number(two[item.id] ?? 2);
        if (a !== 2 && b !== 2) { both++; if (a === b) { agree++; truth.set(item.id, a === 1); } }
    }
    console.log(`${items.length} news; both judges sure on ${both}, agree on ${agree} (${pct(agree, both)}); kept ${truth.size}; hedged by the judges: ${[...truth.values()].filter(Boolean).length}\n`);

    const ai = {};
    for (const variant of Object.keys(VARIANTS)) if (existsSync(`${DIR}/out-${variant}.json`)) ai[variant] = read(`out-${variant}.json`);
    const kept = items.filter(item => truth.has(item.id));
    const detectors = {'words': (item) => Boolean(item.words)};
    for (const variant of Object.keys(ai)) {
        detectors[`ai ${variant}`] = (item) => ai[variant][item.id] === true;
        detectors[`words AND ai ${variant} (veto)`] = (item) => Boolean(item.words) && ai[variant][item.id] !== false;
        detectors[`words OR ai ${variant}`] = (item) => Boolean(item.words) || ai[variant][item.id] === true;
    }
    console.log(`${'detector'.padEnd(34)} ${'flags'.padStart(5)} ${'TP'.padStart(4)} ${'FP'.padStart(4)} ${'FN'.padStart(4)}   precision  recall`);
    for (const [name, detect] of Object.entries(detectors)) {
        let tp = 0, fp = 0, fn = 0;
        for (const item of kept) {
            const said = detect(item), real = truth.get(item.id);
            if (said && real) tp++; else if (said) fp++; else if (real) fn++;
        }
        console.log(`${name.padEnd(34)} ${String(tp + fp).padStart(5)} ${String(tp).padStart(4)} ${String(fp).padStart(4)} ${String(fn).padStart(4)}   ${pct(tp, tp + fp)}      ${pct(tp, tp + fn)}`);
    }

    // The same figures at the natural proportions: the sample holds 42% of marked news, the words mark 0.9% of the real ones, so the recall of
    // the words (and the false alarms of an AI that reads the news the words leave) are read on the news each language really has
    const share = (item) => {
        const group = GROUPS.find(one => one.langs.includes(item.lang));
        const natural = NATURAL[group.name];
        const inGroup = kept.filter(other => group.langs.includes(other.lang) && other.set === item.set).length;
        return (item.set === 'marked' ? natural.marked : natural.news - natural.marked) / inGroup;
    };
    const total = Object.values(NATURAL).reduce((sum, one) => sum + one.news, 0);
    console.log(`\nat the natural proportions of the ${total} news of 14 days (each news counts for the news of its language it stands for):`);
    console.log(`${'detector'.padEnd(34)} ${'flags/1000'.padStart(10)} ${'hedged/1000'.padStart(11)}   precision  recall`);
    for (const [name, detect] of Object.entries(detectors)) {
        let tp = 0, fp = 0, fn = 0, all = 0, real = 0;
        for (const item of kept) {
            const weight = share(item), said = detect(item), truly = truth.get(item.id);
            all += weight;
            if (truly) real += weight;
            if (said && truly) tp += weight; else if (said) fp += weight; else if (truly) fn += weight;
        }
        console.log(`${name.padEnd(34)} ${(1000 * (tp + fp) / all).toFixed(1).padStart(10)} ${(1000 * real / all).toFixed(1).padStart(11)}   ${pct(tp, tp + fp)}      ${pct(tp, tp + fn)}`);
    }

    // the veto on the news the words mark: what it takes out
    console.log('\nthe news the words mark (what a veto changes):');
    const marked = kept.filter(item => item.set === 'marked');
    console.log(`  ${marked.length} read, ${marked.filter(item => truth.get(item.id)).length} really hedged (precision of the words ${pct(marked.filter(item => truth.get(item.id)).length, marked.length)})`);
    for (const variant of Object.keys(ai)) {
        const vetoed = marked.filter(item => ai[variant][item.id] === false);
        const right = vetoed.filter(item => !truth.get(item.id)).length;
        const lost = vetoed.filter(item => truth.get(item.id)).length;
        const unanswered = marked.filter(item => ai[variant][item.id] === undefined).length;
        console.log(`  veto ${variant.padEnd(6)}: ${String(vetoed.length).padStart(3)} taken out, ${right} rightly (not hedged), ${lost} wrongly (hedged, lost); ${unanswered} unanswered`);
    }
    const unmarked = kept.filter(item => item.set === 'unmarked');
    console.log(`\nthe news the words do NOT mark: ${unmarked.length} read, ${unmarked.filter(item => truth.get(item.id)).length} really hedged (missed by the words)`);
    for (const variant of Object.keys(ai)) {
        const flagged = unmarked.filter(item => ai[variant][item.id] === true);
        console.log(`  ai ${variant.padEnd(6)}: ${String(flagged.length).padStart(3)} flagged, ${flagged.filter(item => truth.get(item.id)).length} rightly, ${flagged.filter(item => !truth.get(item.id)).length} wrongly`);
    }

    // what to read by hand: the errors of the best way
    const best = process.argv[3] ?? 'desc';
    if (ai[best]) {
        console.log(`\nerrors of "words AND ai ${best}" (FP) and misses of the words (FN):`);
        const line = (item, why) => console.log(`  ${why} [${item.id}] (${item.lang}${item.words ? `, ${item.words}` : ''}) ${item.title.slice(0, 110)}`);
        for (const item of kept) {
            const said = Boolean(item.words) && ai[best][item.id] !== false, real = truth.get(item.id);
            if (said && !real) line(item, 'FP');
            else if (!said && real && item.words) line(item, 'LOST');
        }
        for (const item of kept) if (!item.words && truth.get(item.id)) line(item, 'MISSED');
    }
};

const command = process.argv[2];
try {
    if (command === 'build') await build();
    else if (command === 'run') await run(process.argv[3]);
    else if (command === 'score') score();
    else console.log('node --env-file=.env bench/hedging/veto.mjs build | run <title|desc|think> | score [variant]');
} finally {
    await prisma.$disconnect();
}
