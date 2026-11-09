//
//  Author: Fabian Rostello
//  Date: 09.11.2026
//  File: duplicate-cards.mjs
//  Description: Measures whether an AI that reads the whole briefing at the end (as the proofreading does, proofread.js) finds the cards that tell
//               the SAME news (the user, 9.11.2026: "des fois la même histoire est présentée sur 2 cartes différentes sur le même briefing").
//               The history: the merge step (keepSameNews, "in doubt null") misses some; a pairwise variant "does the card above already
//               answer it" joined both duplicates of 25 briefings and 4 other developments out of 5 (decision log, 3.11.2026: joining wrongly
//               hides a news). Here: the cards of the saved briefings, gemma4:31b and deepseek-v4-pro (thinking off and on) each reading a
//               whole briefing in one call, the pairs they group, then the pairs judged blind from the full texts (same news / a development of
//               the same affair / different), and pairs no model grouped but that share words or names, judged too, to see what they miss
//
//  node --env-file=.env bench/duplicate-cards.mjs build              the briefings, bench/data/duplicates/dataset.json
//  node --env-file=.env bench/duplicate-cards.mjs run <config>       gemma | deepseek-off | deepseek-on, answers in out-<config>.json
//  node --env-file=.env bench/duplicate-cards.mjs pairs              the pairs to judge: pairs.json, judge.md (blind), judge-key.json
//  node --env-file=.env bench/duplicate-cards.mjs score              reads verdicts-*.json (judges) and prints the table
//

import process from 'node:process';
import {mkdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import {prisma} from '../config/db.js';
import {ProfileModel} from '../models/profile-model.js';
import {readerLanguage, writtenIn} from '../services/utils/language.js';
import {newUsage, ollamaJson} from '../services/utils/ollama.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';

const DIR = 'bench/data/duplicates';
const DAYS = 20;
const MIN_CARDS = 12;
const BRIEFINGS = 60;
const words = (text) => String(text ?? '').split(/\s+/).filter(Boolean);
const clip = (text, n) => words(text).slice(0, n).join(' ');
const norm = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

const textOf = (item) => String(item.translation ?? item.summary ?? '').replace(/[-⚠]/g, '');
const STOP = new Set('the a an of to in on at for and or is are was were be with by from as that this it its after over into about new says said will not no his her their has have had than more'.split(' '));
const tokens = (text) => new Set(norm(text).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 2 && !STOP.has(word)));

const build = async () => {
    const rows = await prisma.$queryRawUnsafe(`SELECT id, id_profile, items FROM briefings WHERE status = 'ready' AND created_at > now() - ($1 || ' days')::interval
        AND jsonb_array_length(items) >= $2 ORDER BY id DESC LIMIT $3`, String(DAYS), MIN_CARDS, BRIEFINGS);
    const profiles = new Map();
    const briefings = [];
    for (const row of rows) {
        if (!profiles.has(row.id_profile)) profiles.set(row.id_profile, row.id_profile ? await ProfileModel.get(row.id_profile) : null);
        const language = readerLanguage(profiles.get(row.id_profile) ?? {});
        const cards = row.items.map((item, i) => ({
            n: i + 1, storyId: item.storyId, merged: item.mergedStoryIds ?? [], title: norm(item.titleTranslation ?? item.title), source: item.lead?.source ?? '',
            media: item.corroboration?.media ?? 1, names: (item.names ?? []).slice(0, 5).map(name => name.name), passage: clip(textOf(item).split(/\n\n/)[0], 50),
            text: textOf(item).split(/\n\n/).slice(0, 3).map(norm).join('\n'), urls: [item.lead?.url, ...(item.articles ?? []).map(article => article.url)].filter(Boolean),
        }));
        briefings.push({id: row.id, profile: row.id_profile, language, cards});
    }
    mkdirSync(DIR, {recursive: true});
    writeFileSync(`${DIR}/dataset.json`, JSON.stringify(briefings));
    console.log(`${briefings.length} briefings, ${briefings.reduce((sum, one) => sum + one.cards.length, 0)} cards, ${briefings.reduce((sum, one) => sum + one.cards.length * (one.cards.length - 1) / 2, 0)} pairs`);
};

// ---- the reader of the whole briefing
const promptOf = (briefing) => `Here are the cards of a news briefing, each with its number, its title, how many media tell it, the first sentences of its text and the people and organisations it names. The reader reads in ${writtenIn(briefing.language) ?? briefing.language}.

${briefing.cards.map(card => `[${card.n}] ${card.title}\n    ${card.media} media${card.names.length ? ` | names: ${card.names.join(', ')}` : ''}\n    ${card.passage}`).join('\n\n')}

Find the cards that tell THE SAME NEWS: the same event, decision, statement or result, so that a reader who has read one learns nothing new from the other. Cards on the same affair that tell a different fact are NOT the same news: a reaction to it, a question and its answer, the next step, a consequence, what another person said, another match, another person, an earlier or a later stage.

When in doubt, do not group. Most briefings have no such cards. Answer only in JSON: {"groups": [{"cards": [numbers], "same": "the one fact they all tell"}]}`;

const CONFIGS = {
    gemma: {model: undefined, think: undefined},
    'deepseek-off': {model: 'deepseek-v4-pro:0813', think: false},
    'deepseek-on': {model: 'deepseek-v4-pro:0813', think: true},
};

const run = async (name) => {
    const config = CONFIGS[name];
    if (!config) throw new Error(`config: ${Object.keys(CONFIGS).join(', ')}`);
    const dataset = JSON.parse(readFileSync(`${DIR}/dataset.json`, 'utf8'));
    const usage = newUsage();
    const started = Date.now();
    const results = await mapWithConcurrency(dataset, name === 'deepseek-on' ? 3 : 2, async (briefing) => {
        const t0 = Date.now();
        let answer = null, error = null;
        for (let attempt = 0; attempt < 2 && !answer; attempt++) {
            try {
                answer = await ollamaJson(promptOf(briefing), usage, {model: config.model, think: config.think, fallback: null, timeoutMs: 400e3});
            } catch (err) {
                error = err.message;
            }
        }
        const groups = (Array.isArray(answer?.groups) ? answer.groups : []).map(group => ({cards: [...new Set((Array.isArray(group?.cards) ? group.cards : []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= briefing.cards.length))], same: String(group?.same ?? '')}))
            .filter(group => group.cards.length >= 2);
        console.log(`${name}: briefing ${briefing.id} ${groups.length} groups ${Math.round((Date.now() - t0) / 100) / 10} s${answer ? '' : ` FAILED ${String(error).slice(0, 60)}`}`);
        return {id: briefing.id, groups, seconds: Math.round((Date.now() - t0) / 100) / 10, failed: !answer};
    });
    writeFileSync(`${DIR}/out-${name}.json`, JSON.stringify({name, usage, seconds: Math.round((Date.now() - started) / 1000), results: results.map(result => result.status === 'fulfilled' ? result.value : {failed: true})}));
    console.log(`${name}: ${Math.round((Date.now() - started) / 1000)} s, tokens ${JSON.stringify(usage)}`);
};

// ---- the pairs
const pairKey = (briefing, a, b) => `${briefing}:${Math.min(a, b)}-${Math.max(a, b)}`;
const groupedPairs = (out) => {
    const pairs = new Set();
    for (const result of out.results) for (const group of result.groups ?? []) {
        for (let i = 0; i < group.cards.length; i++) for (let j = i + 1; j < group.cards.length; j++) pairs.add(pairKey(result.id, group.cards[i], group.cards[j]));
    }
    return pairs;
};

const pairs = () => {
    const dataset = JSON.parse(readFileSync(`${DIR}/dataset.json`, 'utf8'));
    const outs = Object.keys(CONFIGS).filter(name => existsSync(`${DIR}/out-${name}.json`)).map(name => [name, groupedPairs(JSON.parse(readFileSync(`${DIR}/out-${name}.json`, 'utf8')))]);
    const all = [];
    for (const briefing of dataset) {
        const cards = briefing.cards;
        for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
            const a = cards[i], b = cards[j];
            const key = pairKey(briefing.id, a.n, b.n);
            const flaggedBy = outs.filter(([, set]) => set.has(key)).map(([name]) => name);
            const ta = tokens(a.title), tb = tokens(b.title);
            const shared = [...ta].filter(word => tb.has(word)).length;
            const jaccard = shared / Math.max(1, new Set([...ta, ...tb]).size);
            const sharedNames = a.names.filter(name => b.names.includes(name)).length;
            const sharedUrl = a.urls.some(url => b.urls.includes(url)) || a.merged.includes(b.storyId) || b.merged.includes(a.storyId) || a.storyId === b.storyId;
            // candidates the models did not group: title words or names in common
            const close = jaccard >= 0.3 || (sharedNames >= 2 && jaccard >= 0.15);
            if (flaggedBy.length > 0 || sharedUrl || close) all.push({briefing: briefing.id, a, b, flaggedBy, jaccard: Math.round(jaccard * 100) / 100, sharedNames, sharedUrl, close});
        }
    }
    all.forEach((pair, i) => { pair.id = i + 1; });
    return {all, outs};
};

const writePairs = () => {
    const {all} = pairs();
    // blind: shuffled by a seed, no model name, no briefing order
    let seed = 20261109;
    const random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const order = all.map(pair => [random(), pair]).sort((x, y) => x[0] - y[0]).map(([, pair]) => pair);
    const key = order.map((pair, i) => ({n: i + 1, id: pair.id, briefing: pair.briefing, a: pair.a.n, b: pair.b.n, flaggedBy: pair.flaggedBy, jaccard: pair.jaccard, sharedNames: pair.sharedNames, sharedUrl: pair.sharedUrl, close: pair.close}));
    const md = order.map((pair, i) => `## Pair ${i + 1}\n\n**Card A** — ${pair.a.title} (${pair.a.source}, ${pair.a.media} media)\n${pair.a.text}\n\n**Card B** — ${pair.b.title} (${pair.b.source}, ${pair.b.media} media)\n${pair.b.text}\n`).join('\n');
    writeFileSync(`${DIR}/judge-key.json`, JSON.stringify(key));
    writeFileSync(`${DIR}/judge.md`, md);
    const flagged = key.filter(one => one.flaggedBy.length > 0).length;
    console.log(`${key.length} pairs to judge: ${flagged} grouped by at least one model, ${key.filter(one => one.flaggedBy.length === 0 && one.close).length} close but grouped by none, ${key.filter(one => one.sharedUrl).length} sharing an article or a story`);
};

const score = () => {
    const key = JSON.parse(readFileSync(`${DIR}/judge-key.json`, 'utf8'));
    const verdicts = [1, 2].filter(n => existsSync(`${DIR}/verdicts-${n}.json`)).map(n => JSON.parse(readFileSync(`${DIR}/verdicts-${n}.json`, 'utf8')));
    if (verdicts.length === 0) { console.log('no verdicts yet'); return; }
    const label = (n) => verdicts.map(set => set[String(n)]?.verdict ?? set[n]?.verdict ?? set[n]);
    const agreed = key.filter(one => new Set(label(one.n)).size === 1);
    console.log(`${key.length} pairs, ${verdicts.length} judges, agree on ${agreed.length}`);
    // the verdict stands when the judges agree; a pair they split on is DISPUTED and counts for neither
    const final = new Map(key.map(one => [one.n, new Set(label(one.n)).size === 1 ? label(one.n)[0] : 'DISPUTED']));
    const counts = (list) => list.reduce((acc, one) => { acc[final.get(one.n)] = (acc[final.get(one.n)] ?? 0) + 1; return acc; }, {});
    const dataset = JSON.parse(readFileSync(`${DIR}/dataset.json`, 'utf8'));
    const truth = key.filter(one => final.get(one.n) === 'SAME');
    console.log(`true duplicates (SAME): ${truth.length} in ${new Set(truth.map(one => one.briefing)).size} of ${dataset.length} briefings`);
    for (const name of Object.keys(CONFIGS)) {
        if (!existsSync(`${DIR}/out-${name}.json`)) continue;
        const out = JSON.parse(readFileSync(`${DIR}/out-${name}.json`, 'utf8'));
        const mine = key.filter(one => one.flaggedBy.includes(name));
        const c = counts(mine);
        console.log(`${name.padEnd(14)} grouped ${String(mine.length).padStart(3)} pairs: SAME ${c.SAME ?? 0}, DEVELOPMENT ${c.DEVELOPMENT ?? 0}, DIFFERENT ${c.DIFFERENT ?? 0}, disputed ${c.DISPUTED ?? 0}; found ${mine.filter(one => final.get(one.n) === 'SAME').length}/${truth.length} true; ${out.seconds} s, tokens ${out.usage.input}/${out.usage.output}; failed ${out.results.filter(result => result.failed).length}`);
    }
    const missed = truth.filter(one => one.flaggedBy.length === 0);
    console.log(`true duplicates no model grouped: ${missed.length}`);
    const closeNone = key.filter(one => one.flaggedBy.length === 0);
    console.log('pairs no model grouped, by verdict:', JSON.stringify(counts(closeNone)));
    writeFileSync(`${DIR}/final.json`, JSON.stringify(key.map(one => ({...one, verdict: final.get(one.n), verdicts: label(one.n)}))));
};

// ---- the second look at one pair: both cards with more of their text, "the same news?" asked of each pair alone; the answer lists what each card
// tells that the other does not before it says. The first reader (above) only proposes, this one decides
// 'strict': lists what each card tells that the other does not, then says (it said "same" for 3 pairs of 66: every small detail made a difference);
// 'judge': the three verdicts and the definitions the judges of the pairs were given
const SECOND = {
    'gemma-off': {model: 'gemma4:31b', think: undefined, prompt: 'strict'},
    'gemma-on': {model: 'gemma4:31b', think: true, prompt: 'strict'},
    'deepseek-on': {model: 'deepseek-v4-pro:0813', think: true, prompt: 'strict'},
    'gemma-off-judge': {model: 'gemma4:31b', think: undefined, prompt: 'judge'},
    'gemma-on-judge': {model: 'gemma4:31b', think: true, prompt: 'judge'},
    'deepseek-on-judge': {model: 'deepseek-v4-pro:0813', think: true, prompt: 'judge'},
};
const judgePrompt = (a, b) => `Two cards of a news briefing.

Card A: ${a.title} (${a.source}, ${a.media} media)
${a.text}

Card B: ${b.title} (${b.source}, ${b.media} media)
${b.text}

Give ONE verdict:
- SAME: both cards report the same news: the same event, decision, statement or result. A reader who has read one learns nothing material from the other, so showing both in one briefing is redundant. Different wording, a different medium, or a small extra detail does not make them different news.
- DEVELOPMENT: the same affair or topic, but each card tells at least one fact the other does not: a reaction, a question and its answer, the next step, a consequence, what another person said, another stage (announcement vs result), another match or person.
- DIFFERENT: not the same affair, or only the same broad subject.

Be strict: if one card has a fact (a figure, a person's statement, a new step) that the other lacks and that matters to a reader, it is DEVELOPMENT. When both tell the same fact, it is SAME even if the titles look unlike.

Answer only in JSON: {"verdict": "SAME" or "DEVELOPMENT" or "DIFFERENT", "why": "one short sentence"}`;
const pairPrompt = (a, b) => `Two cards of a news briefing.

Card A: ${a.title} (${a.source}, ${a.media} media)
${a.text}

Card B: ${b.title} (${b.source}, ${b.media} media)
${b.text}

Do they tell THE SAME NEWS? First list what each card tells that the other does not: a fact, a figure, a person's statement, a reaction, the next step, a consequence, another stage, another match or person. Then answer "same" only if neither card tells anything that matters to a reader that the other lacks: the same event, decision, statement or result, so that a reader who has read one learns nothing new from the other. Cards on the same affair that tell a different fact are NOT the same news.

Answer only in JSON: {"only_in_a": "what only card A tells, or null", "only_in_b": "what only card B tells, or null", "same": true or false}`;

const confirm = async (name) => {
    const config = SECOND[name];
    if (!config) throw new Error(`config: ${Object.keys(SECOND).join(', ')}`);
    const key = JSON.parse(readFileSync(`${DIR}/judge-key.json`, 'utf8'));
    const dataset = new Map(JSON.parse(readFileSync(`${DIR}/dataset.json`, 'utf8')).map(briefing => [briefing.id, briefing]));
    const usage = newUsage();
    const started = Date.now();
    const results = await mapWithConcurrency(key, name.startsWith('deepseek') ? 3 : 2, async (one) => {
        const cards = dataset.get(one.briefing).cards;
        const t0 = Date.now();
        let answer = null;
        for (let attempt = 0; attempt < 2 && !answer; attempt++) {
            try {
                answer = await ollamaJson((config.prompt === 'judge' ? judgePrompt : pairPrompt)(cards[one.a - 1], cards[one.b - 1]), usage, {model: config.model, think: config.think, fallback: null, timeoutMs: 400e3});
            } catch { /* asked once more */ }
        }
        return {n: one.n, same: config.prompt === 'judge' ? answer?.verdict === 'SAME' : answer?.same === true, answered: config.prompt === 'judge' ? typeof answer?.verdict === 'string' : typeof answer?.same === 'boolean', onlyA: answer?.only_in_a ?? null, onlyB: answer?.only_in_b ?? null, seconds: Math.round((Date.now() - t0) / 100) / 10};
    });
    const rows = results.map(result => result.status === 'fulfilled' ? result.value : {same: false, answered: false});
    writeFileSync(`${DIR}/confirm-${name}.json`, JSON.stringify({name, usage, seconds: Math.round((Date.now() - started) / 1000), rows}));
    console.log(`${name}: ${rows.length} pairs, ${rows.filter(row => row.same).length} said same, ${rows.filter(row => !row.answered).length} unanswered, ${Math.round((Date.now() - started) / 1000)} s, tokens ${JSON.stringify(usage)}`);
};

// what the whole step would have done on the judged pairs: a first reader proposes (or none: every pair), a second look decides
const confirmed = () => {
    const final = JSON.parse(readFileSync(`${DIR}/final.json`, 'utf8'));
    const truth = final.filter(one => one.verdict === 'SAME').length;
    const seconds = Object.keys(SECOND).filter(name => existsSync(`${DIR}/confirm-${name}.json`)).map(name => [name, JSON.parse(readFileSync(`${DIR}/confirm-${name}.json`, 'utf8'))]);
    const firsts = [['gemma', one => one.flaggedBy.includes('gemma')], ['deepseek-on', one => one.flaggedBy.includes('deepseek-on')], ['any model', one => one.flaggedBy.length > 0], ['every pair', () => true]];
    console.log(`${truth} true duplicates (SAME) among ${final.length} pairs judged; joined = proposed by the first reader AND confirmed by the second look`);
    console.log('first reader'.padEnd(13) + 'second look'.padEnd(13) + 'joined  right(SAME)  wrong(DEVELOPMENT)  wrong(DIFFERENT)  disputed  missed of true  seconds');
    for (const [first, proposes] of firsts) for (const [second, out] of seconds) {
        const said = new Set(out.rows.filter(row => row.same).map(row => row.n));
        const joined = final.filter(one => proposes(one) && said.has(one.n));
        const by = (verdict) => joined.filter(one => one.verdict === verdict).length;
        const found = by('SAME');
        console.log(first.padEnd(13) + second.padEnd(13) + `${String(joined.length).padStart(6)}  ${String(found).padStart(11)}  ${String(by('DEVELOPMENT')).padStart(18)}  ${String(by('DIFFERENT')).padStart(16)}  ${String(by('DISPUTED')).padStart(8)}  ${String(truth - found).padStart(14)}  ${String(out.seconds).padStart(7)}`);
    }
};

const [command, argument] = process.argv.slice(2);
if (command === 'build') await build();
else if (command === 'run') await run(argument);
else if (command === 'pairs') writePairs();
else if (command === 'score') score();
else if (command === 'confirm') await confirm(argument);
else if (command === 'confirmed') confirmed();
else console.error('build | run <gemma|deepseek-off|deepseek-on> | pairs | score | confirm <see SECOND> | confirmed');
await prisma.$disconnect();
process.exit(0);
