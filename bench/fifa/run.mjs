//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: run.mjs
//  Description: Step 1 of the map of the FIFA presidency: the variants of the pipeline against the gold set. A variant reads each passage of a
//               half ("dev" to tune, "test" sealed: read it once, at the end) and says established / uncertain / discarded; the
//               scorecard counts what the map would show wrong. Precision first: the number to minimise is the WRONG COLOUR, an
//               "established" that is not an established position on the same side in the gold set (a wrong association, a
//               passage not about the election, a position that was only uncertain, the other side). Passages the three labellers
//               could not settle and no human decided (needsHuman) are left out of the score. Variants:
//                 S0  the reading of 10.11.2026 (stance.js, one passage, no "uncertain": a signal is established, the rest discarded)
//                 L0  the guide as the prompt, one pass of the model, the status decided by the code from the closed words
//                 L1  L0 + the association shown by the code (fifa-attribution.js); not shown = discarded
//                 L2  L1 + the words the model quotes must be in the text (quoteHeld), else uncertain
//                 L3  L2 three times, unanimity on the status and the side, else uncertain
//                 L4  L2 + a second model reads what would be established: both must agree, else uncertain
//                 L5  L4, and "declared" only when both models say declared, else probable
//
//  node --env-file=.env bench/fifa/run.mjs L0,L1 dev [model=gemma4:31b] [second=deepseek-v4-pro]
//

import {readFileSync, writeFileSync} from 'node:fs';
import process from 'node:process';
import {attribute} from '../../services/utils/fifa-attribution.js';
import {mapWithConcurrency} from '../../services/utils/concurrency.js';
import {newUsage, ollamaJson} from '../../services/utils/ollama.js';
import {quoteHeld, readStance} from '../../services/utils/stance.js';
import {readPassage} from '../../services/utils/fifa-reading.js';
import {MEMBERS as FIFA_MEMBERS} from '../../services/utils/fifa-members.js';
import {dataFile, labelPrompt, problemsOf, statusOf} from './labels.mjs';

const [VARIANTS = 'L0', SPLIT = 'dev', MODEL = 'gemma4:31b', SECOND = 'deepseek-v4-pro'] = process.argv.slice(2);
const pool = new Map(JSON.parse(readFileSync(dataFile('pool.json'), 'utf8')).passages.map(p => [p.id, p]));
const MEMBERS = JSON.parse(readFileSync(new URL('../../services/utils/fifa-members.json', import.meta.url), 'utf8'));
const memberOf = new Map([...MEMBERS.members, ...MEMBERS.confederations].map(m => [m.qid, m]));
const gold = JSON.parse(readFileSync(dataFile('gold.json'), 'utf8')).filter(g => g.split === SPLIT && g.status && !g.duplicateOf && (!g.needsHuman || g.agreement === 'human'));
console.log(`${SPLIT}: ${gold.length} passages with a gold status (${gold.filter(g => g.status === 'established').length} established, ${gold.filter(g => g.status === 'uncertain').length} uncertain, ${gold.filter(g => g.status === 'discarded').length} discarded)`);

const itemOf = (p) => ({
    id: p.id, candidate: p.subject.name,
    association: {name: p.member.name, kind: p.member.level, country: p.member.country, fifaCode: p.member.fifa, acronyms: p.member.acronyms},
    matchedName: p.matched, sentence: p.sentence,
    article: {title: p.article.title, description: p.article.description, medium: p.article.medium, language: p.article.lang, date: p.article.date},
});
const textOf = (p) => `${p.article.title}\n${p.article.description ?? ''}\n${p.sentence}`;

// one reading of the model by the guide, then the status by the code
const labelBy = async (p, model, usage, think = false) => {
    let problems = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const answer = await ollamaJson(labelPrompt(itemOf(p), problems), usage, {model, think, timeoutMs: 240000, fallback: null});
            const label = {...answer, id: p.id};
            problems = problemsOf(label);
            // the rules the code decides: the status is not asked of the model, only checked
            const decided = statusOf(label);
            if (problems.length === 0 || problems.every(text => /status|reason|level/.test(text))) return {...label, status: decided.status, reason: decided.reason, stance: label.stance};
        } catch (error) {
            problems = [`unusable (${String(error.message).slice(0, 60)})`];
        }
    }
    return null;
};
const shown = (label) => label?.status === 'established';
// the words the model quotes as showing the stance must be in the text (stance.js quoteHeld): else the colour is not given
const quoted = (label, p) => typeof label?.quote === 'string' && label.quote.trim() !== '' && quoteHeld(label.quote, {title: p.article.title, passage: `${p.sentence}
${p.article.description ?? ''}`});
const reduce = (label, p, attributed, quote = false) => {
    if (!label) return {status: 'uncertain', reason: 'ambiguous', stance: 'none', level: 'none', unreadable: true};
    if (attributed && !attribute({member: memberOf.get(p.member.qid), matched: p.matched, text: textOf(p), lang: p.article.lang}).ok) return {status: 'discarded', reason: '', stance: label.stance, level: 'none', byCode: true};
    if (quote && label.status === 'established' && !quoted(label, p)) return {status: 'uncertain', reason: 'ambiguous', stance: label.stance, level: label.level, quoteNotHeld: true};
    return {status: label.status, reason: label.reason, stance: label.stance, level: label.level};
};

const VARIANT = {
    S0: async (p, usage) => {
        const {reading, decision} = await readStance({subject: {name: p.subject.name}, association: {name: p.member.name, country: p.member.country, aliases: p.member.acronyms},
            article: {title: p.article.title, passage: p.sentence, medium: p.article.medium, date: p.article.date}}, usage, {model: MODEL});
        return decision.signal ? {status: 'established', reason: '', stance: reading.stance, level: decision.position.endsWith('declare') ? 'declared' : 'probable'} : {status: 'discarded', reason: '', stance: 'none', level: 'none'};
    },
    L0: async (p, usage) => reduce(await labelBy(p, MODEL, usage), p, false),
    L1: async (p, usage) => reduce(await labelBy(p, MODEL, usage), p, true),
    // P = what the server runs (services/utils/fifa-reading.js readPassage): L5 through the production code, to see that it reads what the bench measured
    P: async (p, usage) => {
        const passage = {hash: p.id, member: FIFA_MEMBERS.get(p.member.qid), matched: p.matched, sentence: p.sentence, article: p.article};
        const reading = await readPassage({passage, subject: {name: p.subject.name}}, {usage, firstModel: MODEL, secondModel: SECOND});
        return {status: reading.status, reason: reading.reason, stance: reading.stance, level: reading.level, byCode: Boolean(reading.byCode)};
    },
    L2: async (p, usage) => reduce(await labelBy(p, MODEL, usage), p, true, true),
    L3: async (p, usage) => {
        const reads = [];
        for (let i = 0; i < 3; i++) reads.push(reduce(await labelBy(p, MODEL, usage), p, true, true));
        const same = reads.every(r => r.status === reads[0].status && r.stance === reads[0].stance);
        return same ? reads[0] : {status: reads.some(r => r.status !== 'discarded') ? 'uncertain' : 'discarded', reason: 'ambiguous', stance: 'none', level: 'none'};
    },
    L4: async (p, usage) => {
        const first = reduce(await labelBy(p, MODEL, usage), p, true, true);
        if (first.status !== 'established') return first;
        const second = reduce(await labelBy(p, SECOND, usage, true), p, true, true);
        return second.status === 'established' && second.stance === first.stance ? first : {status: 'uncertain', reason: 'ambiguous', stance: 'none', level: 'none'};
    },
    // L5 = L4, and "declared" only when both models say declared: the level of the two readings differ on a fifth of the passages
    L5: async (p, usage) => {
        const first = reduce(await labelBy(p, MODEL, usage), p, true, true);
        if (first.status !== 'established') return first;
        const second = reduce(await labelBy(p, SECOND, usage, true), p, true, true);
        if (!(second.status === 'established' && second.stance === first.stance)) return {status: 'uncertain', reason: 'ambiguous', stance: 'none', level: 'none'};
        return {...first, level: first.level === 'declared' && second.level === 'declared' ? 'declared' : 'probable'};
    },
};

// the upper bound of the 95% interval of Wilson of k out of n
const wilson = (k, n) => {
    if (n === 0) return [0, 1];
    const z = 1.96, p = k / n, d = 1 + z * z / n;
    const centre = (p + z * z / (2 * n)) / d, half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
    return [Math.max(0, centre - half), Math.min(1, centre + half)];
};
const pct = (x) => `${(100 * x).toFixed(1)}%`;

for (const name of VARIANTS.split(',')) {
    if (!VARIANT[name]) { console.log(`unknown variant ${name}`); continue; }
    const usage = newUsage();
    const started = Date.now();
    // mapWithConcurrency answers like Promise.allSettled: a passage whose call failed is read as "uncertain, unreadable" (never as a colour)
    const preds = (await mapWithConcurrency(gold, 4, async (g) => ({id: g.id, ...await VARIANT[name](pool.get(g.id), usage)})))
        .map((result, i) => result.status === 'fulfilled' ? result.value : {id: gold[i].id, status: 'uncertain', reason: 'ambiguous', stance: 'none', level: 'none', unreadable: true});
    const by = new Map(gold.map(g => [g.id, g]));
    const shownList = preds.filter(x => x.status === 'established');
    const wrongColour = shownList.filter(x => { const g = by.get(x.id); return !(g.status === 'established' && g.stance === x.stance); });
    const kinds = {offTopicOrWrongAssociation: wrongColour.filter(x => by.get(x.id).status === 'discarded').length, overconfident: wrongColour.filter(x => by.get(x.id).status === 'uncertain').length,
        wrongSide: wrongColour.filter(x => by.get(x.id).status === 'established').length};
    const goldEstablished = gold.filter(g => g.status === 'established');
    const found = goldEstablished.filter(g => { const x = preds.find(y => y.id === g.id); return x.status === 'established' && x.stance === g.stance; });
    const uncertainShown = preds.filter(x => x.status === 'uncertain');
    const badUncertain = uncertainShown.filter(x => by.get(x.id).status === 'discarded').length;
    const relevant = gold.filter(g => g.status !== 'discarded');
    const kept = relevant.filter(g => preds.find(y => y.id === g.id).status !== 'discarded').length;
    const bothEstablished = shownList.filter(x => by.get(x.id).status === 'established' && by.get(x.id).stance === x.stance);
    const levelRight = bothEstablished.filter(x => x.level === by.get(x.id).level).length;
    const [lo, hi] = wilson(wrongColour.length, shownList.length);
    const card = {
        variant: name, split: SPLIT, model: MODEL, passages: gold.length, shownEstablished: shownList.length, wrongColour: wrongColour.length, wrongColourRate: shownList.length ? wrongColour.length / shownList.length : 0,
        wrongColourWilson95: [lo, hi], kinds, recallEstablished: goldEstablished.length ? found.length / goldEstablished.length : 0, shownUncertain: uncertainShown.length,
        uncertainOffTopicOrWrongAssociation: badUncertain, contentKept: relevant.length ? kept / relevant.length : 0, levelAccuracy: bothEstablished.length ? levelRight / bothEstablished.length : 0,
        usage, seconds: Math.round((Date.now() - started) / 1000), preds,
    };
    writeFileSync(dataFile(`run-${name}-${SPLIT}-${MODEL.replace(/[^\w.-]/g, '-')}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify(card, null, 1));
    console.log(`\n== ${name} (${MODEL}, ${SPLIT}, ${card.seconds}s, ${usage.calls} calls, ${usage.input} in / ${usage.output} out)`);
    console.log(`shown as established ${shownList.length}: WRONG COLOUR ${wrongColour.length} = ${pct(card.wrongColourRate)} (95% interval ${pct(lo)}-${pct(hi)}) [wrong association/off topic ${kinds.offTopicOrWrongAssociation}, was only uncertain ${kinds.overconfident}, other side ${kinds.wrongSide}]`);
    console.log(`recall of the established: ${found.length}/${goldEstablished.length} = ${pct(card.recallEstablished)} | level right among the ones shown right: ${levelRight}/${bothEstablished.length}`);
    console.log(`shown as uncertain ${uncertainShown.length} (of which not about the election or wrong association: ${badUncertain}) | content kept ${kept}/${relevant.length} = ${pct(card.contentKept)}`);
}
