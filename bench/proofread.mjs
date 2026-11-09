//
//  Author: Fabian Rostello
//  Date: 09.11.2026
//  File: proofread.mjs
//  Description: Measures an AI "proofreading" of the cards of a briefing, in flag-only form (the user, 9.11.2026: "une relecture pour éviter
//               les mêmes problèmes aux différentes étapes"): the AI reads the title and the first points of each card as the reader sees
//               them and says which exact pieces are NOT the article's own words (a dateline, a caption, the label of a paywall, a credit,
//               text in another language, a promotion); the code checks each piece (verbatim, at an end of the text, short) before it
//               would take it out. What is measured: against the defects the code finds in the cards of the saved briefings of 14 days
//               ("natural"), and against defects put in clean cards ("synthetic", known by construction), the recall by kind, the
//               false alarms on cards left clean, the time and the tokens, for gemma4:31b and deepseek-v4-pro (thinking off and on)
//
//  node --env-file=.env bench/proofread.mjs build              the cards to read, bench/data/proofread/dataset.json
//  node --env-file=.env bench/proofread.mjs run <config>       gemma | deepseek-off | deepseek-on, answers in out-<config>.json
//  node --env-file=.env bench/proofread.mjs score              recall, false alarms, time, tokens; writes the flags to judge by hand
//

import process from 'node:process';
import {mkdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import {prisma} from '../config/db.js';
import {ProfileModel} from '../models/profile-model.js';
import {isPhotoCaption, withoutDateline} from '../services/utils/extract.js';
import {withoutAccessLabel} from '../services/utils/neutral-titles.js';
import {readerLanguage, shownLanguage} from '../services/utils/language.js';
import {newUsage, ollamaJson} from '../services/utils/ollama.js';

const DIR = 'bench/data/proofread';
const DAYS = 14;
const NATURAL = 240;           // cards of the saved briefings, as they are
const PER_KIND = 20;           // cards each kind of defect is put in
const AT_ONCE = 20;            // cards in one call
const POINTS = 3;              // paragraphs of the card shown to the AI

// a seeded random, the same cards every run
const seeded = (seed) => () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffled = (list, random) => list.map(item => [random(), item]).sort((a, b) => a[0] - b[0]).map(([, item]) => item);
const words = (text) => String(text ?? '').split(/\s+/).filter(Boolean).length;
const norm = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

// ---- what the reader sees of a card: its title and its first points
const viewOf = (item) => {
    const text = item.pointsTranslation ?? item.points ?? item.translation ?? item.summary ?? '';
    return {title: item.titleTranslation ?? item.title, points: String(text).split(/\n\n/).map(norm).filter(Boolean).slice(0, POINTS)};
};

// ---- the defects the code finds in a view: [{field, kind, text}]
const removedPart = (text, bare) => text.startsWith(bare) ? text.slice(bare.length).trim() : text.endsWith(bare) ? text.slice(0, text.length - bare.length).trim() : text;
const defectsOf = (view, language = 'en') => {
    const found = [];
    const bare = withoutAccessLabel(view.title);
    if (bare !== view.title) found.push({field: 'title', kind: 'label', text: removedPart(view.title, bare)});
    const titleLanguage = shownLanguage(view.title);
    if (titleLanguage && titleLanguage !== language) found.push({field: 'title', kind: 'foreign', text: view.title});
    view.points.forEach((point, i) => {
        const cleaned = i === 0 ? withoutDateline(point) : point;
        if (isPhotoCaption(point)) found.push({field: 'points', kind: 'caption', text: point});
        else if (cleaned !== point) found.push({field: 'points', kind: 'dateline', text: point.slice(0, point.length - cleaned.length).trim()});
        const written = shownLanguage(point);
        if (written && written !== language && !isPhotoCaption(point)) found.push({field: 'points', kind: 'foreign', text: point});
    });
    return found;
};

// ---- the defects put in clean cards: each kind known by construction
const CITIES = ['ZURICH: ', 'NYON – ', 'DAR ES SALAAM: ', 'MADRID - ', 'JAKARTA: ', 'ORANJESTAD – ', 'FLORENCE: ', 'CAIRO – '];
const WIRES = ['WASHINGTON (Reuters) - ', 'LONDON, Nov 6 (Reuters) - ', '(CNN) — ', 'PARIS (AFP) – ', 'NEW YORK (AP) — ', 'ROME (ANSA) - '];
const CREDITS = ['HIBAPRESS: ', 'Photo: AFP/Getty Images – ', 'By Staff Reporter | ', 'Source: TPO — ', 'Image credit: Reuters. '];
const CAPTIONS = ['EAST RUTHERFORD, NEW JERSEY - JULY 19: The president and the head of the federation hold the trophy at the award ceremony after the final match.',
    'DOHA, QATAR - NOVEMBER 21: A general view of the stadium before the match between the two teams during the tournament.',
    'ZURICH, SWITZERLAND - OCTOBER 3: The president of the federation looks on during the draw at the headquarters of the body.'];
const LABELS = [' [premium]', ' (S+)', ' (+)', ' [Abo]', ' | PREMIUM', ' [paywall]'];
const JUNK = ['Read more: the referee who changed the match', 'Subscribe to our newsletter to get every story first.', 'Follow us on social networks for more news.', 'Related: all the results of the weekend'];
const pick = (list, random) => list[Math.floor(random() * list.length)];

const injections = {
    dateline_city: (view, random, ctx) => { const p = pick(CITIES, random); view.points[0] = p + view.points[0]; return [{field: 'points', kind: 'dateline', text: p.trim()}]; },
    dateline_wire: (view, random) => { const p = pick(WIRES, random); view.points[0] = p + view.points[0]; return [{field: 'points', kind: 'dateline', text: p.trim()}]; },
    credit: (view, random) => { const p = pick(CREDITS, random); view.points[0] = p + view.points[0]; return [{field: 'points', kind: 'credit', text: p.trim()}]; },
    caption: (view, random) => { const c = pick(CAPTIONS, random); view.points.unshift(c); view.points = view.points.slice(0, POINTS); return [{field: 'points', kind: 'caption', text: c}]; },
    label_title: (view, random) => { const l = pick(LABELS, random); view.title += l; return [{field: 'title', kind: 'label', text: l.trim()}]; },
    foreign: (view, random, ctx) => { const s = pick(ctx.foreignSentences, random); view.points[Math.min(1, view.points.length - 1) + (view.points.length > 1 ? 0 : 1)] = s; return [{field: 'points', kind: 'foreign', text: s}]; },
    junk: (view, random) => { const j = pick(JUNK, random); view.points[view.points.length - 1] += ' ' + j; return [{field: 'points', kind: 'junk', text: j}]; },
};

const build = async () => {
    const rows = await prisma.$queryRawUnsafe(`SELECT id, id_profile, items FROM briefings WHERE status = 'ready' AND created_at > now() - ($1 || ' days')::interval ORDER BY id`, String(DAYS));
    const profiles = new Map();
    const seen = new Set();
    const cards = [];
    const foreignSentences = [];
    for (const row of rows) {
        if (!profiles.has(row.id_profile)) profiles.set(row.id_profile, row.id_profile ? await ProfileModel.get(row.id_profile) : null);
        if (readerLanguage(profiles.get(row.id_profile) ?? {}) !== 'en') continue;
        for (const item of row.items ?? []) {
            const key = `${item.storyId}|${item.lead?.url ?? item.title}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const view = viewOf(item);
            if (view.points.length === 0 || words(view.title) < 3) continue;
            cards.push({view, defects: defectsOf(view)});
            // an original sentence of a card in another language, for the "foreign" defect
            if (item.language && item.language !== 'en' && item.summary) {
                const first = norm(String(item.summary).split(/\n\n/)[0]);
                if (words(first) >= 8 && words(first) <= 40 && shownLanguage(first) && shownLanguage(first) !== 'en') foreignSentences.push(first);
            }
        }
    }
    const random = seeded(20261109);
    const clean = shuffled(cards.filter(card => card.defects.length === 0), random);
    const dirty = cards.filter(card => card.defects.length > 0);
    const natural = shuffled([...dirty, ...clean.slice(0, Math.max(0, NATURAL - dirty.length))], random).slice(0, NATURAL);
    const used = new Set(natural.map(card => card.view.title));
    const pool = clean.filter(card => !used.has(card.view.title));
    const kinds = Object.keys(injections);
    const synthetic = [];
    kinds.forEach((kind, k) => {
        for (const base of pool.slice(k * PER_KIND, (k + 1) * PER_KIND)) {
            const view = {title: base.view.title, points: [...base.view.points]};
            const defects = injections[kind](view, random, {foreignSentences});
            synthetic.push({view, defects, injected: kind});
        }
    });
    const controls = pool.slice(kinds.length * PER_KIND, kinds.length * PER_KIND + 100).map(card => ({view: card.view, defects: [], injected: 'control'}));
    const all = shuffled([...natural.map(card => ({...card, origin: 'natural'})), ...synthetic.map(card => ({...card, origin: 'synthetic'})), ...controls.map(card => ({...card, origin: 'control'}))], random)
        .map((card, i) => ({id: i + 1, ...card}));
    mkdirSync(DIR, {recursive: true});
    writeFileSync(`${DIR}/dataset.json`, JSON.stringify(all));
    const count = (origin) => all.filter(card => card.origin === origin).length;
    console.log(`${all.length} cards: ${count('natural')} natural (${all.filter(card => card.origin === 'natural' && card.defects.length > 0).length} with a defect of the code), ${count('synthetic')} synthetic (${kinds.map(kind => `${kind} ${all.filter(card => card.injected === kind).length}`).join(', ')}), ${count('control')} clean controls; ${foreignSentences.length} foreign sentences available`);
    const naturalKinds = {};
    for (const card of all.filter(card => card.origin === 'natural')) for (const d of card.defects) naturalKinds[d.kind] = (naturalKinds[d.kind] ?? 0) + 1;
    console.log('defects of the code in the natural cards:', JSON.stringify(naturalKinds));
};

// ---- the reader of the cards: flag only, every piece copied as written
const promptOf = (cards) => `You proofread the cards of a news briefing before a reader sees them. Each card has a title and its first sentences ("points"), shown in English exactly as the reader will see them.

Say, for each card, which pieces of text are NOT what the article itself says nor its title:
- dateline: a place, a date or an agency tag opening a sentence ("PLACE:", "PLACE –", "PLACE (AGENCY) -", a date and a dash)
- caption: a sentence that describes a photo (a place and a date, who or what is seen, a photographer)
- label: a label of access or of format in the title or in a sentence ("[premium]", "(+)", "Video:", "Live:")
- credit: a byline, a photo credit or the tag of a medium
- foreign: text that is not written in English
- junk: navigation or promotion ("Read more", "Subscribe", "Follow us"), a sentence repeated, a word cut off

Copy each piece EXACTLY as written, character for character, with the field it is in ("title" or "points"). Do not report style, grammar, tone, opinions or facts, and never a piece of the news itself: a name, a quote, a figure, a date inside a sentence. Most cards are fine: for those, give an empty list.

${cards.map(card => `[${card.id}] title: ${card.view.title}\n${card.view.points.map((point, i) => `    points ${i + 1}: ${point}`).join('\n')}`).join('\n\n')}

Answer only in JSON: {"cards": [{"id": number, "problems": [{"field": "title" or "points", "kind": "dateline" or "caption" or "label" or "credit" or "foreign" or "junk", "text": "the exact piece"}]}]}`;

const CONFIGS = {
    gemma: {model: 'gemma4:31b', think: undefined},
    'deepseek-off': {model: 'deepseek-v4-pro:0813', think: false},
    'deepseek-on': {model: 'deepseek-v4-pro:0813', think: true},
};

const run = async (name) => {
    const config = CONFIGS[name];
    if (!config) throw new Error(`config: ${Object.keys(CONFIGS).join(', ')}`);
    const dataset = JSON.parse(readFileSync(`${DIR}/dataset.json`, 'utf8'));
    const usage = newUsage();
    const calls = [];
    const flags = new Map();
    for (let start = 0; start < dataset.length; start += AT_ONCE) {
        const batch = dataset.slice(start, start + AT_ONCE);
        const t0 = Date.now();
        let answer = null;
        let error = null;
        for (let attempt = 0; attempt < 2 && !answer; attempt++) {
            try {
                answer = await ollamaJson(promptOf(batch), usage, {model: config.model, think: config.think, fallback: null, timeoutMs: 280e3});
            } catch (err) {
                error = err.message;
            }
        }
        calls.push({start, seconds: Math.round((Date.now() - t0) / 100) / 10, error: answer ? null : error});
        for (const one of Array.isArray(answer?.cards) ? answer.cards : []) {
            if (Number.isInteger(one?.id) && Array.isArray(one.problems)) flags.set(one.id, one.problems.filter(problem => problem && typeof problem.text === 'string'));
        }
        console.log(`${name}: ${Math.min(start + AT_ONCE, dataset.length)}/${dataset.length} cards, ${calls.at(-1).seconds} s${error && !answer ? `, FAILED ${error.slice(0, 80)}` : ''}`);
    }
    writeFileSync(`${DIR}/out-${name}.json`, JSON.stringify({name, config, usage, calls, flags: [...flags]}));
    console.log(`${name}: tokens ${JSON.stringify(usage)}, ${calls.reduce((sum, call) => sum + call.seconds, 0)} s in all`);
};

// ---- the code that would check a flag before taking the piece out
const SHORT_PIECE = 16;       // words, a dateline or a label is short
const verified = (view, field, problem) => {
    const text = norm(problem.text);
    if (!text) return false;
    const sources = field === 'title' ? [view.title] : view.points;
    const source = sources.find(one => norm(one).includes(text));
    if (!source) return false;
    const whole = norm(source);
    const atStart = whole.startsWith(text);
    const atEnd = whole.endsWith(text);
    if (problem.kind === 'foreign') return whole === text && (() => { const written = shownLanguage(text); return Boolean(written) && written !== 'en'; })();
    if (problem.kind === 'caption') return whole === text;
    return (atStart || atEnd) && words(text) <= SHORT_PIECE && words(text) < words(whole);
};

const overlaps = (a, b) => {
    const x = norm(a).toLowerCase(), y = norm(b).toLowerCase();
    return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x));
};

const score = () => {
    const dataset = JSON.parse(readFileSync(`${DIR}/dataset.json`, 'utf8'));
    const byId = new Map(dataset.map(card => [card.id, card]));
    const toJudge = [];
    const report = {};
    for (const name of Object.keys(CONFIGS)) {
        if (!existsSync(`${DIR}/out-${name}.json`)) continue;
        const out = JSON.parse(readFileSync(`${DIR}/out-${name}.json`, 'utf8'));
        const flags = new Map(out.flags);
        const failedCalls = out.calls.filter(call => call.error).length;
        const rows = {recall: {}, total: {}, rawFlags: 0, verifiedFlags: 0, unmatchedVerified: 0, unmatchedRaw: 0, cardsFlagged: 0, controlFlagged: 0, controls: 0};
        for (const card of dataset) {
            const given = flags.get(card.id) ?? [];
            const checked = given.filter(problem => verified(card.view, problem.field === 'title' ? 'title' : 'points', problem));
            rows.rawFlags += given.length;
            rows.verifiedFlags += checked.length;
            if (given.length > 0) rows.cardsFlagged++;
            if (card.origin === 'control') { rows.controls++; if (checked.length > 0) rows.controlFlagged++; }
            // recall: every defect of the card (the code's or the one put in), found by a verified flag of the same field that overlaps it
            for (const defect of card.defects) {
                const key = `${card.origin === 'natural' ? 'natural' : 'put in'} ${defect.kind}`;
                rows.total[key] = (rows.total[key] ?? 0) + 1;
                if (checked.some(problem => (problem.field === 'title' ? 'title' : 'points') === defect.field && overlaps(problem.text, defect.text))) rows.recall[key] = (rows.recall[key] ?? 0) + 1;
            }
            // what no known defect explains: false alarm, or a defect the code does not know; judged by hand
            for (const problem of checked) {
                const explained = card.defects.some(defect => defect.field === (problem.field === 'title' ? 'title' : 'points') && overlaps(problem.text, defect.text));
                if (!explained) {
                    rows.unmatchedVerified++;
                    toJudge.push({model: name, cardId: card.id, origin: card.origin, kind: problem.kind, field: problem.field, text: norm(problem.text), title: card.view.title, points: card.view.points});
                }
            }
            rows.unmatchedRaw += given.filter(problem => !card.defects.some(defect => overlaps(problem.text, defect.text))).length;
        }
        report[name] = {rows, usage: out.usage, seconds: Math.round(out.calls.reduce((sum, call) => sum + call.seconds, 0)), failedCalls};
    }
    const kinds = [...new Set(Object.values(report).flatMap(one => Object.keys(one.rows.total)))].sort();
    console.log('\nrecall of the flags that the code would accept (found / defects):');
    console.log('kind'.padEnd(24) + Object.keys(report).map(name => name.padStart(16)).join(''));
    for (const kind of kinds) console.log(kind.padEnd(24) + Object.keys(report).map(name => `${report[name].rows.recall[kind] ?? 0}/${report[name].rows.total[kind] ?? 0}`.padStart(16)).join(''));
    console.log('\n' + ['cards flagged', 'raw flags', 'flags the code accepts', 'accepted flags no known defect explains', 'clean controls flagged', 'seconds', 'calls failed', 'tokens in', 'tokens out']
        .map((label, i) => label.padEnd(42) + Object.keys(report).map(name => String([
            report[name].rows.cardsFlagged, report[name].rows.rawFlags, report[name].rows.verifiedFlags, report[name].rows.unmatchedVerified,
            `${report[name].rows.controlFlagged}/${report[name].rows.controls}`, report[name].seconds, report[name].failedCalls, report[name].usage.input, report[name].usage.output][i]).padStart(16)).join('')).join('\n'));
    writeFileSync(`${DIR}/to-judge.json`, JSON.stringify(toJudge));
    console.log(`\n${toJudge.length} accepted flags that no known defect explains -> ${DIR}/to-judge.json`);
};

const [command, argument] = process.argv.slice(2);
if (command === 'build') await build();
else if (command === 'run') await run(argument);
else if (command === 'score') score();
else console.error('build | run <gemma|deepseek-off|deepseek-on> | score');
await prisma.$disconnect();
process.exit(0);
