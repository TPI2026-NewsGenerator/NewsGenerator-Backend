//
//  Author: Fabian Rostello
//  Date: 09.11.2026
//  File: proofread.js
//  Description: The last read of the cards of a briefing before the reader sees them (the user, 9.11.2026: the same problems since the start of the
//               project, a translation not done, a word nobody wants in a title or in the key points, "une relecture pour éviter tout ça").
//               The AI (gemma4:31b) reads the title and the first paragraphs of each card as the reader will see them and says which exact
//               pieces are NOT the article's own words: a dateline, a photo credit, a label, a caption, text in another language, a
//               promotion. It only POINTS: the code checks each piece before taking it out (copied as written, at the start or at the end of
//               a sentence, set apart by a mark, short, a sentence still following) and writes what it took out, and what it left, in the
//               log and on the card (proofread). Measured on 480 cards on 9.11.2026 (bench/proofread.mjs): see docs/briefing/README.md.
//               It never fails and never waits long: the AI not answering leaves the cards as they are
//
//  The AI proposes, the code decides, as for the neutral titles (neutral-titles.js). What the code does not know how to take out safely
//  (a caption, a promotion, a piece in the middle of a sentence) is only reported: each report is a case for the corpus
//  (tests/regression) and then a rule of the code, so that the next briefing does not need the AI for it
//

"use strict"

import process from 'node:process';
import {mapWithConcurrency} from './concurrency.js';
import {isPhotoCaption} from './extract.js';
import {newUsage, ollamaJson} from './ollama.js';
import {shownLanguage, writtenIn} from './language.js';
import {UNCHECKED, withoutOriginalMarks} from './original-marks.js';

// cards in one call (measured with 20), calls at once, the paragraphs of each way of reading the AI is shown
export const PROOFREAD_AT_ONCE = 20;
const CALLS_AT_ONCE = 3;
const PARAGRAPHS = 3;
// a piece that is a dateline, a credit or a label is short
const SHORT_PIECE = {title: 8, text: 16};
// what must be left of a title, of a paragraph, once a piece is taken out
const MIN_LEFT = {title: 3, text: 6};
// the AI is not waited for longer than this, whatever the calls do (a call is 3 to 8 s)
const CALL_TIMEOUT_MS = 60e3;
const DEADLINE_MS = 90e3;

export const KINDS = ['dateline', 'caption', 'label', 'credit', 'foreign', 'junk'];
export const FIELDS = ['title', 'passages', 'points', 'digest'];
// the kinds the code takes out when it checks the piece; a caption is reported only. A piece the AI calls junk is a mark of the medium as
// often as a promotion ("| Yalla Shoot", measured on 9.11.2026): the same checks decide, and a promotion alone in its sentence ("Read more:
// the referee who changed the match") is no piece set apart by a mark at the edge of one
const TAKEN_OUT = new Set(['dateline', 'credit', 'label', 'junk']);

// the ways to read a card (see formats.js of the client): the field the reader sees in each, the translation first
const WAYS = {passages: ['translation', 'summary'], points: ['pointsTranslation', 'points'], digest: ['digestTranslation', 'digest']};
const shownKey = (item, field) => field === 'title'
    ? (item.titleTranslation ? 'titleTranslation' : item.title ? 'title' : null)
    : WAYS[field].find(key => item[key]) ?? null;

const norm = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const words = (text) => norm(text).split(' ').filter(Boolean).length;
const short = (text, n = 60) => norm(text).slice(0, n);
const readable = (text) => norm(withoutOriginalMarks(String(text ?? '')).replaceAll(UNCHECKED, ''));

// What the reader tells the AI to read: the title and the first paragraphs of each way, as the reader sees them (the marks of a sentence
// left in its language and the sign of figures not matched are not words)
export const viewOf = (item) => ({
    title: readable(item[shownKey(item, 'title')]),
    ways: Object.keys(WAYS).map(field => [field, String(item[shownKey(item, field)] ?? '').split(/\n\n/).map(readable).filter(Boolean).slice(0, PARAGRAPHS)])
        .filter(([, paragraphs]) => paragraphs.length > 0),
});

export const proofreadPrompt = (views, language) => {
    const name = writtenIn(language) ?? language;
    return `You proofread the cards of a news briefing before a reader sees them. Each card has a title and its first paragraphs in up to three ways of reading it ("passages", "points", "digest"), shown in ${name} exactly as the reader will see them.

Say, for each card, which pieces of text are NOT what the article itself says nor its title:
- dateline: a place, a date or an agency tag opening a sentence ("PLACE:", "PLACE –", "PLACE (AGENCY) -", a date and a dash)
- caption: a sentence that describes a photo (a place and a date, who or what is seen, a photographer)
- label: a label of access or of format in the title or in a sentence ("[premium]", "(+)", "Video:", "Live:")
- credit: a byline, a photo credit or the tag of a medium
- foreign: text that is not written in ${name}
- junk: navigation or promotion ("Read more", "Subscribe", "Follow us"), a sentence repeated, a word cut off

Copy each piece EXACTLY as written, character for character, with the field it is in ("title", "passages", "points" or "digest"). Do not report style, grammar, tone, opinions or facts, and never a piece of the news itself: a name, a quote, a figure, a date inside a sentence. Most cards are fine: for those, give an empty list.

${views.map((view, i) => `[${i + 1}] title: ${view.title}\n${view.ways.flatMap(([field, paragraphs]) => paragraphs.map((paragraph, at) => `    ${field} ${at + 1}: ${paragraph}`)).join('\n')}`).join('\n\n')}

Answer only in JSON: {"cards": [{"id": number, "problems": [{"field": "title" or "passages" or "points" or "digest", "kind": "dateline" or "caption" or "label" or "credit" or "foreign" or "junk", "text": "the exact piece"}]}]}`;
};

// The flags of an answer: Map index of the card in the call -> [{field, kind, text}]. What is not of this shape is dropped, the AI answering
// what cannot be read leaves the cards as they are
export const normalizeFlags = (answer, count) => {
    const flags = new Map();
    for (const card of Array.isArray(answer?.cards) ? answer.cards : []) {
        const index = Number(card?.id) - 1;
        if (!Number.isInteger(index) || index < 0 || index >= count || !Array.isArray(card.problems)) continue;
        // the field as the AI copied it from the card it read: "passages 1" (the label of the paragraph) as often as "passages"
        const list = card.problems.map(problem => ({field: String(problem?.field ?? '').trim().toLowerCase().match(/^[a-z]+/)?.[0] ?? '', kind: String(problem?.kind ?? '').trim().toLowerCase(), text: norm(problem?.text)}))
            .filter(problem => FIELDS.includes(problem.field) && KINDS.includes(problem.kind) && problem.text);
        const known = flags.get(index) ?? [];
        for (const problem of list) if (!known.some(one => one.field === problem.field && one.kind === problem.kind && one.text === problem.text)) known.push(problem);
        if (known.length > 0) flags.set(index, known);
    }
    return flags;
};

// ---- what the code checks before it takes a piece out of a sentence
// A mark that sets a piece apart from the sentence: after it ("VIDEO:", "GENEVA --", "By Staff |", "(Reuters) -", "(pic)") or before it
// ("Messi scores – by Paolo Moramarco", "Messi scores | Yalla Shoot", "Messi scores (pic)")
const MARKS = String.raw`:;|–—−\-·•/`;
const AFTER_MARK = new RegExp(String.raw`^\s*[${MARKS})\]]`, 'u');
const BEFORE_MARK = new RegExp(String.raw`[${MARKS}([]\s*$`, 'u');
const ENDS_WITH_MARK = new RegExp(String.raw`[${MARKS})\]]$`, 'u');
const STARTS_WITH_MARK = new RegExp(String.raw`^[${MARKS}([]`, 'u');
const LEADING_MARKS = new RegExp(String.raw`^[\s${MARKS}]+`, 'u');
const TRAILING_MARKS = new RegExp(String.raw`[\s${MARKS}]+$`, 'u');
// A label that tells the reader what the text IS (an opinion is no news, a live page is not an article) is part of what it says: kept, as the
// capitals of FIFA or BREAKING are kept by the dateline of a city (SUBJECTS of extract.js)
const INFORMS = /^[\s\p{P}]*(?:opinion|analysis|analyse|análisis|editorial|éditorial|exclusive|exclusif|exclusivo|breaking|urgent|live|en direct|en vivo|ao vivo|investigation|enquête|review|critique|interview|entretien|entrevista|explainer|fact[- ]?check|factbox|column|chronique|tribune|special report|dernière minute|última hora)(?![\p{L}])/iu;

// What a label of the title or of a sentence that tells nothing of the news is made of, when it is no tag between brackets: the format of the
// page or its access ("VIDEO:", "Thursday briefing:", "PREMIUM |"). The competition or the section the news is of ("Ligue 1: US Monastir
// denounces the refereeing…") says something: the AI called it a label in the briefings of 9.11.2026, it is not taken out
const FORMAT = /(?<![\p{L}])(?:videos?|vidéos?|vídeos?|photos?|fotos?|pics?|images?|gallery|galerie|galería|watch|listen|podcast|newsletter|briefing|premium|paywall|subscribers?|abonnés|abonnement|abo|plus)(?![\p{L}])/iu;
const TAG = /^[[(].*[\])]$/u;

// The text without the piece, or null when the code does not take it out: the piece is short, copied as written at the start or at the end of
// the text, set apart from the sentence by a mark, what follows it at the start is the start of a sentence (not a lower case word: "As Gazzetta
// reports, the…" is the sentence), and enough is left. 'part': 'title' or 'text'. Not a caption (its place and its date are what makes it
// one: what is left would pass for a sentence of the article), not a label that tells what the text is or that is no format of the page (see
// FORMAT), and a dateline only opens the first paragraph: a date and a dash further on open the line of a timeline, which the date is part of
// (as undated of extract.js). 'first': the text is the title or the first paragraph of its way
export const cutPiece = (text, piece, {kind = 'dateline', part = 'text', first = true} = {}) => {
    const whole = norm(text);
    const wanted = norm(piece);
    if (!wanted || words(wanted) > SHORT_PIECE[part] || words(wanted) >= words(whole)) return null;
    if (kind === 'label' && (INFORMS.test(wanted) || !TAG.test(wanted) && !FORMAT.test(wanted))) return null;
    if (kind === 'dateline' && !first || isPhotoCaption(whole)) return null;
    if (whole.startsWith(wanted)) {
        const rest = whole.slice(wanted.length);
        if (!ENDS_WITH_MARK.test(wanted) && !AFTER_MARK.test(rest)) return null;
        const left = rest.replace(LEADING_MARKS, '');
        return !/^\p{Ll}/u.test(left) && words(left) >= MIN_LEFT[part] ? left : null;
    }
    if (whole.endsWith(wanted)) {
        const rest = whole.slice(0, whole.length - wanted.length);
        if (!STARTS_WITH_MARK.test(wanted) && !BEFORE_MARK.test(rest)) return null;
        const left = rest.replace(TRAILING_MARKS, '');
        return words(left) >= MIN_LEFT[part] ? left : null;
    }
    return null;
};

// The card with the pieces taken out that the code checked, and what the AI pointed at that it left: {item, taken: [{kind, text, fields}],
// left: [{field, kind, text, why}]}. A piece verified in one way of reading is taken out of the others when it stands at the edge of their
// sentences too: the ways are made of the same sentences. 'language': the reader's
export const proofread = (item, flags, language) => {
    const slots = [...FIELDS].map(field => ({field, key: shownKey(item, field)})).filter(slot => slot.key)
        .map(slot => ({...slot, part: slot.field === 'title' ? 'title' : 'text', paragraphs: slot.field === 'title' ? [String(item[slot.key])] : String(item[slot.key]).split(/\n\n/)}));
    const left = [];
    const edges = [];
    const wholes = [];
    for (const flag of flags) {
        const present = slots.some(slot => slot.paragraphs.some(paragraph => norm(paragraph).includes(flag.text)));
        if (!present) continue;
        if (!TAKEN_OUT.has(flag.kind) && flag.kind !== 'foreign') {
            left.push({...flag, why: `a ${flag.kind} is only reported`});
        } else if (flag.kind === 'foreign') {
            const written = shownLanguage(flag.text);
            const places = slots.filter(slot => slot.field !== 'title' && slot.paragraphs.some(paragraph => norm(paragraph) === flag.text));
            if (!written || written === language) left.push({...flag, why: 'the letters do not say it is another language'});
            else if (places.length === 0) left.push({...flag, why: flag.field === 'title' ? 'a title is not taken out' : 'not a whole paragraph of the text'});
            else if (places.every(slot => slot.paragraphs.length < 2)) left.push({...flag, why: 'the only paragraph'});
            else wholes.push(flag);
        } else if (slots.some(slot => slot.paragraphs.some((paragraph, at) => cutPiece(paragraph, flag.text, {kind: flag.kind, part: slot.part, first: at === 0}) !== null))) {
            edges.push(flag);
        } else {
            left.push({...flag, why: 'not set apart at the start or the end of a sentence, or too long, or a caption, or a label that tells what the text is or is no format of the page'});
        }
    }
    if (edges.length === 0 && wholes.length === 0) return {item, taken: [], left};

    const changes = {};
    const applied = new Map();
    for (const slot of slots) {
        let changed = false;
        let paragraphs = slot.paragraphs.map((paragraph, at) => {
            let text = paragraph;
            for (let again = true; again;) {
                again = false;
                for (const edge of edges) {
                    const cut = cutPiece(text, edge.text, {kind: edge.kind, part: slot.part, first: at === 0});
                    if (cut === null) continue;
                    text = cut;
                    again = true;
                    changed = true;
                    applied.set(`${edge.kind}|${edge.text}`, [...new Set([...(applied.get(`${edge.kind}|${edge.text}`) ?? []), slot.field])]);
                }
            }
            return text;
        });
        const bare = paragraphs.filter(paragraph => !wholes.some(flag => norm(paragraph) === flag.text));
        if (slot.field !== 'title' && bare.length < paragraphs.length && bare.length > 0) {
            for (const flag of wholes) if (paragraphs.some(paragraph => norm(paragraph) === flag.text)) {
                applied.set(`foreign|${flag.text}`, [...new Set([...(applied.get(`foreign|${flag.text}`) ?? []), slot.field])]);
            }
            paragraphs = bare;
            changed = true;
        }
        if (changed) changes[slot.key] = slot.field === 'title' ? paragraphs[0] : paragraphs.join('\n\n');
    }
    const taken = [...applied].map(([key, fields]) => ({kind: key.slice(0, key.indexOf('|')), text: key.slice(key.indexOf('|') + 1), fields}));
    for (const flag of wholes) if (!applied.has(`foreign|${flag.text}`)) left.push({...flag, why: 'the only paragraph'});
    if (taken.length === 0) return {item, taken, left};
    return {item: {...item, ...changes, proofread: [...(item.proofread ?? []), ...taken]}, taken, left};
};

// The cards of a briefing proofread: a new list, the cards changed being new objects, the others the same ones. 'label': the briefing, for the
// log. Never throws: the AI not answering, answering what cannot be read, or taking too long leaves the cards as they are
export const proofreadCards = async (items, language, {usage = null, label = 'unsaved', log = console, atOnce = PROOFREAD_AT_ONCE} = {}) => {
    if (items.length === 0 || process.env.AI_PROOFREAD === 'off') return items;
    const tokens = usage ?? newUsage();
    const started = Date.now();
    let timer;
    try {
        const views = items.map(viewOf);
        const chunks = Array.from({length: Math.ceil(items.length / atOnce)}, (_, i) => ({from: i * atOnce, views: views.slice(i * atOnce, (i + 1) * atOnce)}));
        const reading = mapWithConcurrency(chunks, CALLS_AT_ONCE, async (chunk) => {
            let answer = null;
            for (let attempt = 0; attempt < 2 && !answer; attempt++) {
                try {
                    answer = await ollamaJson(proofreadPrompt(chunk.views, language), tokens, {timeoutMs: CALL_TIMEOUT_MS});
                } catch (err) {
                    if (attempt === 1) throw err;
                }
            }
            return [...normalizeFlags(answer, chunk.views.length)].map(([index, list]) => [chunk.from + index, list]);
        });
        const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer in ${DEADLINE_MS / 1e3} s`)), DEADLINE_MS); });
        const results = await Promise.race([reading, late]);
        const flags = new Map();
        results.forEach((result, i) => {
            if (result.status === 'fulfilled') for (const [index, list] of result.value) flags.set(index, list);
            else log.error(`Briefing ${label}: proofread: the cards ${chunks[i].from + 1} to ${chunks[i].from + chunks[i].views.length} were not read (${result.reason?.message})`);
        });

        let taken = 0, left = 0;
        const cards = items.map((item, index) => {
            const flagged = flags.get(index);
            if (!flagged) return item;
            const done = proofread(item, flagged, language);
            const card = short(item.titleTranslation ?? item.title, 50);
            for (const one of done.taken) log.log(`Briefing ${label}: proofread: took out "${short(one.text, 80)}" (${one.kind}, ${one.fields.join(' and ')}) of the card "${card}"`);
            for (const one of done.left) log.log(`Briefing ${label}: proofread: left "${short(one.text, 80)}" (${one.kind}, ${one.field}: ${one.why}) in the card "${card}"`);
            taken += done.taken.length;
            left += done.left.length;
            return done.item;
        });
        log.log(`Briefing ${label}: proofread: ${items.length} cards read in ${Math.round((Date.now() - started) / 1000)} s (${chunks.length} calls, tokens ${JSON.stringify(tokens)}), ${taken} pieces taken out, ${left} left`);
        return cards;
    } catch (err) {
        log.error(`Briefing ${label}: the cards were not proofread (${err.message})`);
        return items;
    } finally {
        clearTimeout(timer);
    }
};
