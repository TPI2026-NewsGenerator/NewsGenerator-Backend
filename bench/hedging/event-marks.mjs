//
//  Author: Fabian Rostello
//  Date: 11.11.2026
//  File: event-marks.mjs
//  Description: The reliability of the three badges of an event of an affair as the reader sees them ("Reported", "Official", "Contested"), and of
//               other ways to decide them (the user, 11.11.2026: "juge la méthode et étudie s'il est peut-être bien de changer la méthode de
//               Reported"). The events are the ones events.mjs built with the code of the product. Three strata of events are read by two blind
//               judges: the ones that carry a mark, the ones that carry none but whose news hold a word of a mark (what the AND of the AI and
//               the words may have lost), the ones with no word at all (what no word can find). The figures are given at the natural
//               proportions of the events built (each event counts for the events of its stratum it stands for).
//
//               The ways compared, for each badge: what the product does; an AI that reads the event (the lead title and up to 8 of its news,
//               title and beginning of the text), alone, AND the product, OR the product; and for "Reported" the rule that turns the hedges of
//               the news into the hedge of the event (any news, a third of them, the half it uses now).
//
//  node --env-file=.env bench/hedging/event-marks.mjs sample     the events to judge: bench/data/hedging/events-dataset.json, blind chunks in judge-events/
//  node --env-file=.env bench/hedging/event-marks.mjs run         the AI that reads the events: out-events.json
//  node --env-file=.env bench/hedging/event-marks.mjs score       the labels (labels-ev-<judge>-<chunk>.json) against the product and the AI
//

import process from 'node:process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {prisma} from '../../config/db.js';
import {feedsOf} from '../../services/briefing-service.js';
import {storiesWithNews} from '../../services/utils/affair.js';
import {markEvents} from '../../services/utils/affair-marks.js';
import {hasDenial} from '../../services/utils/contested.js';
import {hedgedBy} from '../../services/utils/hedging.js';
import {newUsage, ollamaJson} from '../../services/utils/ollama.js';
import {hasStatement} from '../../services/utils/statements.js';

const DIR = 'bench/data/hedging';
const SHOWN = 8;                  // the news of an event shown to the judges and to the AI
const TEXT = 240;                 // the characters of the beginning of a news
const CAPS = {marked: 150, near: 140, none: 100};
const AT_ONCE = 6;                // events in a call of the AI
const MARKS = ['official', 'denial', 'reported'];

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

// the flags of the words on one news, as the product reads it
const flagsOf = (item) => {
    const text = `${squash(item.title)}. ${squash(item.description)}`;
    return {hedge: hedgedBy(item.title, squash(item.description)), denial: hasDenial(text, item.lang), statement: hasStatement(text)};
};

// ---- sample
const sample = async () => {
    mkdirSync(`${DIR}/judge-events`, {recursive: true});
    const built = read('affairs-built.json').filter(one => one.affair);
    const events = new Map();
    const feeds = new Map();
    for (const one of built) {
        const fresh = one.events.filter(event => !events.has(event.id));
        if (fresh.length === 0) continue;
        if (!feeds.has(one.profile)) feeds.set(one.profile, await feedsOf(one.profile));
        const ids = [...new Set(fresh.flatMap(event => event.storyIds))];
        const stories = new Map((await storiesWithNews(ids.map(id => ({id, via: 'bench', likeness: 0})), feeds.get(one.profile), new Date(Date.now() - 30 * 24 * 3600e3)))
            .map(story => [story.storyId, story]));
        for (const event of fresh) {
            const news = event.storyIds.flatMap(id => stories.get(id)?.news ?? []).map(item => ({
                lang: item.lang, medium: item.medium, title: squash(item.title), description: cut(squash(item.description), TEXT), ...flagsOf(item)}));
            if (news.length === 0) continue;
            const hedged = news.filter(item => item.hedge).length;
            const denials = news.filter(item => item.denial).length;
            const statements = news.filter(item => item.statement).length;
            const marked = Boolean(event.reported || event.official || event.denial);
            events.set(event.id, {id: event.id, affair: one.affairTitle, at: event.at, title: event.title, translation: event.titleTranslation ?? null,
                media: event.media.length, languages: event.languages.length, count: event.news, kind: event.kind,
                reported: event.reported ?? null, official: Boolean(event.official), denial: Boolean(event.denial),
                hedged, denials, statements, news,
                stratum: marked ? 'marked' : hedged + denials + statements > 0 ? 'near' : 'none'});
        }
        console.log(`${one.affairTitle?.slice(0, 50)}: ${events.size} events so far`);
    }
    const all = [...events.values()];
    const random = seeded(11112027);
    const kept = [];
    const sizes = {};
    for (const stratum of ['marked', 'near', 'none']) {
        const group = all.filter(event => event.stratum === stratum);
        const chosen = shuffled(group, random).slice(0, CAPS[stratum]);
        sizes[stratum] = {natural: group.length, sampled: chosen.length};
        kept.push(...chosen);
    }
    const dataset = shuffled(kept, random).map((event, i) => ({...event, seq: i + 1}));
    // the news shown: the ones a word fired on first, then the others of other media, SHOWN at most
    const shown = (event) => {
        const signal = event.news.filter(item => item.hedge || item.denial || item.statement).slice(0, 4);
        const others = event.news.filter(item => !signal.includes(item));
        const media = new Set(signal.map(item => item.medium));
        const distinct = others.filter(item => !media.has(item.medium) && media.add(item.medium));
        return [...signal, ...distinct, ...others.filter(item => !distinct.includes(item))].slice(0, SHOWN);
    };
    for (const event of dataset) event.shown = shown(event).map(item => ({lang: item.lang, medium: item.medium, title: item.title, description: item.description}));
    write('events-dataset.json', {sizes, events: dataset});
    // what the judges read: no mark, no flag, no stratum
    const blind = dataset.map(event => ({id: event.seq, date: event.at.slice(0, 10), title: event.title, translation: event.translation,
        told: `${event.count} news, ${event.media} media, ${event.languages} languages`, news: event.shown}));
    const third = Math.ceil(blind.length / 4);
    ['A', 'B', 'C', 'D'].forEach((name, i) => write(`judge-events/chunk-${name}.json`, blind.slice(i * third, (i + 1) * third)));
    const byMark = (key) => all.filter(event => key(event)).length;
    console.log(`${all.length} events built; reported ${byMark(e => e.reported)}, official ${byMark(e => e.official)}, denial ${byMark(e => e.denial)}; strata ${JSON.stringify(sizes)}; ${dataset.length} to judge in 4 chunks of ${third}`);
};

// ---- the AI that reads the event
export const DEFINITIONS = `An EVENT of an affair is one fact told by several articles. Below, for each event: its date, its lead title, and some of the articles that tell it (language, medium, title, beginning of the text). Answer three questions about each event.
official: true when a party this event is about (a person, a club, a federation, a body) ANNOUNCED IT ITSELF (its own statement, press release, post, or a decision it publishes) and at least one article reports that statement. False when only journalists or sources say it.
denial: true when at least one article reports that someone NAMED denies, rejects or disputes what the event says or what is alleged. False when someone only comments, answers a question or says nothing of the kind.
reported: true when the articles present the event as UNCONFIRMED: they rest on unnamed or unverifiable sources, on rumour or speculation, or say that they have no confirmation. False when they tell it as a fact; also false for the "alleged" of a crime report, and for a rumour the article denies or confirms.`;

const viewOf = (event, id) => `[${id}] ${event.date ?? event.at?.slice(0, 10)} | ${event.title}${event.translation ? ` (${event.translation})` : ''} | ${event.told ?? `${event.count} news, ${event.media} media`}
${(event.news ?? event.shown).map(item => `   - (${item.lang}, ${item.medium ?? '?'}) ${item.title}${item.description ? ` — ${item.description}` : ''}`).join('\n')}`;

const run = async () => {
    const {events} = read('events-dataset.json');
    const usage = newUsage();
    const answers = {};
    const batches = Array.from({length: Math.ceil(events.length / AT_ONCE)}, (_, i) => events.slice(i * AT_ONCE, (i + 1) * AT_ONCE));
    const started = Date.now();
    let next = 0, failed = 0;
    const worker = async () => {
        while (next < batches.length) {
            const batch = batches[next++];
            const prompt = `${DEFINITIONS}\n\n${batch.map(event => viewOf({...event, news: event.shown}, event.seq)).join('\n\n')}\n\nAnswer only in JSON: {"events": [{"id": number, "official": true or false, "denial": true or false, "reported": true or false}]}`;
            let answer = null;
            for (let attempt = 0; attempt < 2 && !answer; attempt++) {
                try {
                    answer = await ollamaJson(prompt, usage, {timeoutMs: 240e3});
                } catch (err) {
                    if (attempt === 1) { failed++; console.error(`a call failed: ${err.message}`); }
                }
            }
            for (const item of Array.isArray(answer?.events) ? answer.events : []) {
                if (batch.some(event => event.seq === Number(item?.id))) {
                    answers[Number(item.id)] = {official: item.official === true, denial: item.denial === true, reported: item.reported === true};
                }
            }
        }
    };
    await Promise.all(Array.from({length: 3}, worker));
    write('out-events.json', answers);
    console.log(`${Object.keys(answers).length}/${events.length} events answered in ${Math.round((Date.now() - started) / 1000)} s, ${batches.length} calls (${failed} failed), tokens ${JSON.stringify(usage)}`);
};

// ---- the new product: the step of the product itself (affair-marks.js) on the same events, to measure what the reader will get
const product = async () => {
    const {events} = read('events-dataset.json');
    const usage = newUsage();
    const started = Date.now();
    const asked = events.map(event => ({id: event.seq, at: event.at, title: event.title, titleTranslation: event.translation, news: event.count, media: Array(event.media).fill('')}));
    const newsBySeq = new Map(events.map(event => [event.seq, event.news]));
    const marked = await markEvents(asked, (event) => newsBySeq.get(event.id), {usage});
    const answers = Object.fromEntries(marked.filter(event => event.marks).map(event => [event.id, {official: event.marks.official, denial: event.marks.contested, reported: event.marks.reported}]));
    write('out-product.json', answers);
    console.log(`${Object.keys(answers).length}/${events.length} events marked by the product step in ${Math.round((Date.now() - started) / 1000)} s, tokens ${JSON.stringify(usage)}`);
};

// ---- "Official" restricted to statements and communiqués: the events to read again
// The ones that at least one judge called official with the wide definition (a party said it itself, an interview included): with the restricted
// one the answer can only be the same or "no", so the others stay "no". Two chunks, read by two judges again
const officialChunks = () => {
    const {events} = read('events-dataset.json');
    const labelsOf = (judge) => Object.assign({}, ...['A', 'B', 'C', 'D'].map(chunk => JSON.parse(readFileSync(`${DIR}/labels-ev-${judge}-${chunk}.json`, 'utf8'))));
    const one = labelsOf(1), two = labelsOf(2);
    const wide = events.filter(event => Number(one[event.seq]?.[0] ?? 2) !== 0 || Number(two[event.seq]?.[0] ?? 2) !== 0);
    const blind = wide.map(event => ({id: event.seq, date: event.at.slice(0, 10), title: event.title, translation: event.translation,
        told: `${event.count} news, ${event.media} media, ${event.languages} languages`, news: event.shown}));
    const half = Math.ceil(blind.length / 2);
    write('judge-events/official-A.json', blind.slice(0, half));
    write('judge-events/official-B.json', blind.slice(half));
    console.log(`${blind.length} events to read again for the restricted "Official" (${half} and ${blind.length - half}); ids ${blind[0]?.id} to ${blind.at(-1)?.id}`);
};
const narrowOfficial = () => {
    const files = [1, 2].flatMap(judge => ['A', 'B'].map(chunk => `${DIR}/labels-off-${judge}-${chunk}.json`));
    if (!files.every(file => existsSync(file))) return null;
    const labels = (judge) => Object.assign({}, ...['A', 'B'].map(chunk => JSON.parse(readFileSync(`${DIR}/labels-off-${judge}-${chunk}.json`, 'utf8'))));
    const n1 = labels(1), n2 = labels(2);
    return (seq, a, b) => a === 0 && b === 0 ? [0, 0] : [Number(n1[seq] ?? 2), Number(n2[seq] ?? 2)];
};

// ---- score
const pct = (a, b) => b === 0 ? '  -  ' : `${(100 * a / b).toFixed(0).padStart(3)}%`;

const score = () => {
    const {sizes, events} = read('events-dataset.json');
    const labelsOf = (judge) => {
        const labels = {};
        for (const chunk of ['A', 'B', 'C', 'D']) {
            const file = `${DIR}/labels-ev-${judge}-${chunk}.json`;
            if (!existsSync(file)) throw new Error(`missing: ${file}`);
            Object.assign(labels, JSON.parse(readFileSync(file, 'utf8')));
        }
        return labels;
    };
    const one = labelsOf(1), two = labelsOf(2);
    const ai = existsSync(`${DIR}/out-events.json`) ? read('out-events.json') : {};
    const weight = (event) => sizes[event.stratum].natural / sizes[event.stratum].sampled;
    console.log(`${events.length} events judged; strata ${JSON.stringify(sizes)}`);

    const rules = {
        'half of the news (the product)': (event) => event.count > 2 ? event.hedged >= event.news.length / 2 : event.hedged > 0,
        'any news': (event) => event.hedged > 0,
        'a third of the news': (event) => event.news.length <= 3 ? event.hedged > 0 : event.hedged >= event.news.length / 3,
    };
    MARKS.forEach((mark, m) => {
        const truth = new Map();
        let both = 0, agree = 0;
        // "Official" restricted to statements and communiqués (the user, 11.11.2026): the events that no judge called official with the wide
        // definition are not, the others were read again with the restricted one (judge-events/official-*.json, labels-off-*.json)
        const narrow = mark === 'official' ? narrowOfficial() : null;
        for (const event of events) {
            let a = Number(one[event.seq]?.[m] ?? 2), b = Number(two[event.seq]?.[m] ?? 2);
            if (narrow) [a, b] = narrow(event.seq, a, b);
            if (a !== 2 && b !== 2) { both++; if (a === b) { agree++; truth.set(event.seq, a === 1); } }
        }
        const kept = events.filter(event => truth.has(event.seq));
        const title = {official: 'Official', denial: 'Contested', reported: 'Reported'}[mark];
        console.log(`\n=== ${title}: both judges sure on ${both}, agree on ${agree} (${pct(agree, both)}); hedged/true by the judges: ${[...truth.values()].filter(Boolean).length} of ${kept.length}`);
        const current = (event) => mark === 'reported' ? Boolean(event.reported) : Boolean(event[mark]);
        const detectors = {'the product (before)': current};
        if (existsSync(`${DIR}/out-product.json`)) {
            const next = read('out-product.json');
            detectors['the product (new step)'] = (event) => mark === 'reported' ? Boolean(next[event.seq]?.reported) : next[event.seq]?.[mark === 'denial' ? 'denial' : mark] === true;
            const wordOf = {official: 'statements', denial: 'denials', reported: 'hedged'}[mark];
            detectors['new step AND a word in some news'] = (event) => detectors['the product (new step)'](event) && event[wordOf] > 0;
        }
        if (Object.keys(ai).length > 0) {
            detectors['AI that reads the event'] = (event) => ai[event.seq]?.[mark] === true;
            detectors['the product AND the AI'] = (event) => current(event) && ai[event.seq]?.[mark] !== false;
            detectors['the product OR the AI'] = (event) => current(event) || ai[event.seq]?.[mark] === true;
            // the AI that reads the text, and the words of the news as a second look (the way the product combines the title-only AI and the words)
            const word = {official: 'statements', denial: 'denials', reported: 'hedged'}[mark];
            detectors['AI AND a word in some news'] = (event) => ai[event.seq]?.[mark] === true && event[word] > 0;
            detectors['AI AND words on a third of the news'] = (event) => ai[event.seq]?.[mark] === true && event[word] >= Math.max(1, event.news.length / 3);
        }
        if (mark === 'reported') for (const [name, rule] of Object.entries(rules)) if (!name.includes('product')) detectors[`words, ${name}`] = (event) => rule(event) && !event.denial;
        console.log(`${'detector'.padEnd(34)} ${'flags'.padStart(5)} ${'TP'.padStart(4)} ${'FP'.padStart(4)} ${'FN'.padStart(4)}   precision  recall | natural: precision  recall  flags/100 events`);
        const totalNatural = Object.values(sizes).reduce((sum, one2) => sum + one2.natural, 0);
        for (const [name, detect] of Object.entries(detectors)) {
            let tp = 0, fp = 0, fn = 0, wtp = 0, wfp = 0, wfn = 0;
            for (const event of kept) {
                const said = detect(event), real = truth.get(event.seq), w = weight(event);
                if (said && real) { tp++; wtp += w; } else if (said) { fp++; wfp += w; } else if (real) { fn++; wfn += w; }
            }
            console.log(`${name.padEnd(34)} ${String(tp + fp).padStart(5)} ${String(tp).padStart(4)} ${String(fp).padStart(4)} ${String(fn).padStart(4)}   ${pct(tp, tp + fp)}      ${pct(tp, tp + fn)}    |          ${pct(wtp, wtp + wfp)}     ${pct(wtp, wtp + wfn)}   ${(100 * (wtp + wfp) / totalNatural).toFixed(1)}`);
        }
        // where the true events are: in the stratum that carries the mark, or in the others (what the product misses)
        const byStratum = Object.fromEntries(['marked', 'near', 'none'].map(stratum => {
            const group = kept.filter(event => event.stratum === stratum);
            return [stratum, `${group.filter(event => truth.get(event.seq)).length}/${group.length}`];
        }));
        console.log(`true events by stratum (true/read): ${JSON.stringify(byStratum)}`);
        const line = (event, why) => console.log(`  ${why} [${event.seq}] (${event.news.length}n, ${event.languages}L${mark === 'reported' && event.reported ? `, ${event.reported}` : ''}) ${event.title.slice(0, 100)}`);
        for (const event of kept.filter(item => current(item) && !truth.get(item.seq)).slice(0, 8)) line(event, 'FP');
        for (const event of kept.filter(item => !current(item) && truth.get(item.seq)).slice(0, 8)) line(event, 'MISSED');
        for (const event of kept.filter(item => ai[item.seq]?.[mark] === true && !truth.get(item.seq)).slice(0, 8)) line(event, 'AI-FP');
        if (existsSync(`${DIR}/out-product.json`)) {
            const next = read('out-product.json');
            const said = (event) => mark === 'reported' ? Boolean(next[event.seq]?.reported) : next[event.seq]?.[mark] === true;
            for (const event of kept.filter(item => said(item) && !truth.get(item.seq)).slice(0, 10)) line(event, 'NEW-FP');
            for (const event of kept.filter(item => !said(item) && truth.get(item.seq)).slice(0, 6)) line(event, 'NEW-MISSED');
        }
    });
};

const command = process.argv[2];
try {
    if (command === 'sample') await sample();
    else if (command === 'run') await run();
    else if (command === 'product') await product();
    else if (command === 'official-chunks') officialChunks();
    else if (command === 'score') score();
    else console.log('node --env-file=.env bench/hedging/event-marks.mjs sample | run | product | score');
} finally {
    await prisma.$disconnect();
}
