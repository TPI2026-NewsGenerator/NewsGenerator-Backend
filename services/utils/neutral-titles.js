//
//  Author: Fabian Rostello
//  Date: 03.11.2026
//  File: neutral-titles.js
//  Description: The title of a card without the bait of its medium ("Information incroyable !", "Bomba zilei!").
//               The AI only says which teaser of the title to take out, copied as it is; the code checks that it is a
//               whole sentence of the title, apart from the rest by its punctuation, and takes it out. A title is never
//               rewritten, and no word is taken out of the middle of a sentence: what is left is the medium's own
//               sentences, so nothing is added, no sentence is broken and a fact cannot be changed (the user,
//               03.11.2026: "rendre le titre plus neutre"). Taking out any passage the AI found (adjectives, verbs)
//               broke 1 title in 2 when tried the same day (bench/neutral-titles.mjs)
//

"use strict"

import {ollamaJson} from './ollama.js';

// the most words one passage taken out may have, and what a title must keep: a title the AI would gut is left as it was
const MAX_REMOVED_WORDS = 6;
const MIN_WORDS_LEFT = 3;
const MIN_SHARE_LEFT = 0.5;

export const neutralPrompt = (titles) => `Voici des titres d'articles d'actualité, chacun avec son numéro entre crochets, dans leur langue d'origine.

Certains titres commencent ou finissent par une accroche : une phrase ou un mot d'appel qui ne dit AUCUN fait et ne sert qu'à faire cliquer ou à juger (« Information incroyable ! », « Bomba zilei ! », « Urgent : », « Choc : », « À ne pas manquer »), séparée du reste par une ponctuation (! ? : | tiret).
Pour chaque titre qui en a une, recopie-la TELLE QUELLE, ponctuation comprise. Une accroche est entière : une phrase ou un mot d'appel complet, jamais un adjectif ou un mot pris dans une phrase, jamais un verbe, un nom, un chiffre, une négation, ni une citation entre guillemets.
Si le titre sans cette accroche perdait un fait, ou si l'accroche en dit un (« Nouvelles règles ! », « Félicitations au nouveau président »), ce n'est pas une accroche. Un mot qui dit le statut du fait (« Officiel », « Official », « Confirmé », « Rumeur », « Interview ») n'en est pas une non plus. Un titre sans accroche n'a rien à retirer. Dans le doute, ne relève rien.

${titles.map((title, i) => `[${i + 1}] ${title}`).join('\n')}

Réponds uniquement en JSON : {"titles": [{"n": numéro, "remove": ["accroche copiée telle quelle"]}]}`;

// the passages to take out of each title, only for the titles given: Map index (from 0) -> [passage]
export const normalizeRemovals = (answer, count) => {
    const removals = new Map();
    for (const item of Array.isArray(answer?.titles) ? answer.titles : []) {
        const index = Number(String(item?.n ?? '').replace(/^\[|\]$/g, '')) - 1;
        if (!Number.isInteger(index) || index < 0 || index >= count || removals.has(index)) continue;
        const passages = (Array.isArray(item?.remove) ? item.remove : []).filter(passage => typeof passage === 'string' && passage.trim());
        if (passages.length > 0) removals.set(index, passages.map(passage => passage.trim()));
    }
    return removals;
};

// A word that says no: taking it out of a short passage could say the opposite ("did not sign" -> "signed").
// The ones of the languages of the news we read most; a longer passage is a whole phrase of the medium
// ("À ne pas manquer", "Not to be missed")
const NEGATIONS = new Set(['no', 'not', 'never', 'none', 'nobody', 'nothing', 'without', 'non', 'ne', 'pas', 'jamais', 'aucun', 'aucune',
    'sans', 'nie', 'nicht', 'kein', 'keine', 'niemals', 'nunca', 'ningún', 'ninguna', 'sin', 'nem', 'não', 'nunca', 'niet', 'geen',
    'nigdy', 'bez', 'ne', 'nu', 'fără', 'ne', 'ni', 'ουκ', 'δεν', 'не', 'без', 'hayır', 'yok', 'değil']);
const SHORT_PASSAGE = 3;
const wordsOf = (text) => text.split(/\s+/).filter(Boolean);
// the words of a title: what has a letter or a figure in it, not a dash nor an exclamation mark standing alone
const realWordsOf = (text) => wordsOf(text).filter(word => /[\p{L}\p{N}]/u.test(word));
const lettersOf = (word) => word.toLowerCase().replace(/[^\p{L}]+/gu, '');
const NEGATION_MARK = /n['’]t\b/i;

// the quotation marks of the languages we read, in pairs: what is between them is what someone said
const QUOTES = [['"', '"'], ['“', '”'], ['„', '”'], ['„', '“'], ['«', '»'], ['‹', '›'], ['‘', '’'], ['”', '”']];
const quotedSpans = (title) => {
    const spans = [];
    for (const [open, close] of QUOTES) {
        // a quotation mark between two letters is an apostrophe (l’Équipe), not the start of a quote
        let from = 0;
        for (;;) {
            let start = title.indexOf(open, from);
            while (start > 0 && /\p{L}/u.test(title[start - 1]) && /\p{L}/u.test(title[start + 1] ?? '')) start = title.indexOf(open, start + 1);
            if (start === -1) break;
            const end = title.indexOf(close, start + 1);
            if (end === -1) break;
            spans.push([start, end + 1]);
            from = end + 1;
        }
    }
    return spans;
};

// Whether a passage is a teaser apart from the rest of the title: at its start, ended by a mark of the teaser or
// followed by one (« Incroyable : le PSG gagne », « Bomba zilei! L’Equipe: … »); at its end, after the end of a
// sentence or a dash; or between two sentences, after the end of one and ended by a mark. Never a word taken out
// of the middle of a sentence
const standsApart = (title, at, end) => {
    const before = title.slice(0, at).trimEnd();
    const after = title.slice(end).trimStart();
    const passage = title.slice(at, end).trimEnd();
    if (before === '') return after !== '' && (/[!?:|]$/u.test(passage) || /^[:|–—-]/u.test(after));
    if (after === '') return /[.!?:|–—-]$/u.test(before);
    return /[.!?]$/u.test(before) && /[!?.]$/u.test(passage);
};

// whether a passage is safe to take out: copied as it is, a teaser apart from the rest (standsApart), at
// most MAX_REMOVED_WORDS words, no figure, no negation when short, and not what someone said
const takeable = (title, passage) => {
    const at = title.indexOf(passage);
    if (at === -1) return null;
    const words = wordsOf(passage);
    if (!/\p{L}/u.test(passage) || words.length > MAX_REMOVED_WORDS || /\d/.test(passage)) return null;
    if (words.length <= SHORT_PASSAGE && (words.some(word => NEGATIONS.has(lettersOf(word))) || NEGATION_MARK.test(passage))) return null;
    if (!standsApart(title, at, at + passage.length)) return null;
    // an acronym or a capitalized word after the first is a name or a thing (« Escándalo en el VAR », « Neue
    // Regeln »): the fact of the title, not a teaser
    if (words.some((word, i) => /^\P{L}*\p{Lu}{2,}/u.test(word) || (i > 0 && /^\P{L}*\p{Lu}/u.test(word)))) return null;
    if (quotedSpans(title).some(([start, end]) => at >= start && at + passage.length <= end)) return null;
    return [at, at + passage.length];
};

// the separators a passage taken out leaves at the edges of what is left
const EDGES = /^[\s:;,\-–—|·•.!?/]+|[\s:;,\-–—|·•/]+$/gu;
const tidy = (text) => text.replace(/\s{2,}/g, ' ')
    .replace(/([:;,\-–—|·])\s*(?=[:;,\-–—|·])/gu, '')
    .replace(EDGES, '')
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

// A title with its exclamation mark at the end taken out ("Federation in crisis!", "¡Escándalo!"): the tone of the
// medium, not a fact. Not one before a closing quotation mark: it is what someone said
const withoutFinalExclamation = (title) => title.replace(/\s*!+\s*$/u, '');

// the inverted exclamation marks of Spanish left without their closing one ("¡Qué final" once "!" is gone)
const withoutLoneInverted = (title) => title.replace(/¡([^!¡]*)(?=¡|$)/gu, '$1');

// An exclamation mark between two sentences, a full stop in their place ("Nobody wants to lead the Federation! The
// assembly was postponed", "¡Escándalo en el VAR! Denuncian..."): the tone of the medium. Not "Yahoo!", a name, nor
// one in a quotation: it is what someone said
const calmed = (title) => {
    const quoted = quotedSpans(title);
    return title.replace(/¡([^!¡]*)(?<!Yahoo)!+(?=\s+[\p{Lu}„“"«¡])|\s*(?<!Yahoo)!+(?=\s+[\p{Lu}„“"«¡])/gu, (found, inside, at) =>
        quoted.some(([start, end]) => at >= start && at + found.length <= end) ? found : `${inside ?? ''}.`);
};

const startsWithCapital = (text) => /^\p{Lu}/u.test(text);
const capitalized = (text) => text.replace(/^(\P{L}*)(\p{L})/u, (all, before, letter) => before + letter.toUpperCase());

// The title with the passages taken out that pass the checks, the exclamation mark at its end taken out and
// the ones between two sentences made full stops; the title as it was when too little is left: fewer than
// MIN_WORDS_LEFT words, or less than MIN_SHARE_LEFT of its words
export const neutralTitle = (title, passages = []) => {
    const spans = passages.map(passage => takeable(title, passage)).filter(Boolean).sort((a, b) => a[0] - b[0]);
    let text = title;
    if (spans.length > 0) {
        text = '';
        let from = 0;
        for (const [start, end] of spans) {
            if (start < from) continue;
            text += title.slice(from, start);
            from = end;
        }
        text = tidy(text + title.slice(from));
    }
    text = withoutLoneInverted(calmed(withoutFinalExclamation(text)));
    if (text === title) return title;
    if (realWordsOf(text).length < MIN_WORDS_LEFT || realWordsOf(text).length < realWordsOf(title).length * MIN_SHARE_LEFT) return title;
    return startsWithCapital(title) && !startsWithCapital(text) ? capitalized(text) : text;
};

// The titles without their judgment: [title] -> [title], the same length, in the same order. The AI failing, or
// answering what cannot be read, leaves the titles as they are: a card never waits on it
export const neutralTitles = async (titles, usage = null) => {
    if (titles.length === 0) return [];
    try {
        const removals = normalizeRemovals(await ollamaJson(neutralPrompt(titles), usage), titles.length);
        return titles.map((title, i) => removals.has(i) ? neutralTitle(title, removals.get(i)) : neutralTitle(title));
    } catch (err) {
        console.error(`Briefing: the titles were not made neutral (${err.message})`);
        return titles.map(title => neutralTitle(title));
    }
};
