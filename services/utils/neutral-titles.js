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
import {mapWithConcurrency} from './concurrency.js';

// the most words one passage taken out may have, and what a title must keep: a title the AI would gut is left as it was
const MAX_REMOVED_WORDS = 6;
const MIN_WORDS_LEFT = 3;
const MIN_SHARE_LEFT = 0.5;
// the sentences of the article given to the AI that rewrites a title, and the share of the title's words a proposal keeps
// at least (a teaser sentence of half the title goes: « Here is where they will all judge »)
const REWRITE_PASSAGES = 1500;
const REWRITE_MIN_SHARE = 0.4;

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

// A title rewritten on demand, in the e-mail editor (the user, 03.11.2026: "l'IA propose, le lecteur valide").
// The judgment sits inside the sentences too (« une décision honteuse »), where the removal above cannot touch
// it. The AI rewrites the whole title and the reader reads the proposal against the title before using it, so
// an error of meaning never leaves in an e-mail unseen (free rewriting changed the meaning of about 1 card in
// 10 when measured on 12.10.2026). The code still refuses a proposal that adds or loses a name, a figure, a
// negation or a quotation: the reader is shown no proposal rather than a wrong one.
export const rewritePrompt = (title, passages, language = null) => `Voici le titre d'un article d'actualité, puis des phrases de l'article.

Réécris le titre pour qu'il soit NEUTRE : il dit le fait, comme le ferait une agence de presse, sans jugement, sans emphase et sans appel au clic.
À retirer : les adjectifs et adverbes de jugement ou d'intensité (« incroyable », « choc », « honteux », « énorme », « enfin »), les points d'exclamation, les mots en majuscules d'insistance, les questions faites pour attirer, les mots d'appel (« Urgent », « Révélation »).
À garder exactement : les noms de personnes, de lieux et d'organisations, les chiffres, les dates, ce que quelqu'un a dit entre guillemets, les négations, et la certitude du titre (« aurait », « selon X », « pourrait » restent).
N'ajoute AUCUN fait, nom ou chiffre qui n'est ni dans le titre ni dans les phrases. N'explique rien. Écris dans la même langue que le titre${language ? ` (${language}, pas en français)` : ''}, en aussi peu de mots que lui ou moins. Un titre en forme de question reste une question. Un titre déjà neutre : recopie-le tel quel.

Titre : ${title}

Phrases de l'article :
${passages || '(aucune)'}

Réponds uniquement en JSON : {"title": "le titre neutre"}`;

const plainWord = (word) => word.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, '');
// the figures of a text, their separators aside ("2 000", "1,5", "2026")
const numbersOf = (text) => new Set((text.match(/\d{1,3}(?:[ \u00a0\u202f.,]\d{3})+|\d+(?:[.,]\d+)?/g) ?? []).map(number => number.replace(/\D/g, '')));
const hasNegation = (text) => NEGATION_MARK.test(text) || wordsOf(text).some(word => NEGATIONS.has(lettersOf(word)));
const mostlyUpper = (text) => {
    const letters = text.replace(/[^\p{L}]/gu, '');
    return letters.length > 0 && letters.replace(/[^\p{Lu}]/gu, '').length / letters.length > 0.6;
};
// the words of a text, an apostrophe splitting them ("l’Équipe", "L'UEFA")
const tokensOf = (text) => text.split(/[\s'’]+/).filter(Boolean);
// A title with most of its words capitalized is in title case (« Friendship Allstar Crowned EBFA U-17 Youth Ensemble
// Champions »): a capital then says nothing of a name
const inTitleCase = (text) => {
    const long = tokensOf(text).filter(word => /^\P{L}*\p{L}{4,}/u.test(word));
    return long.length >= 5 && long.filter(word => /^\P{L}*\p{Lu}/u.test(word)).length / long.length > 0.7;
};
// the names of a text: a capitalized word that does not open a sentence, an acronym (only acronyms in a title in
// capitals or in title case)
const namesOf = (text) => {
    if (mostlyUpper(text)) return [];
    const words = tokensOf(text);
    const name = inTitleCase(text) ? /^\P{L}*\p{Lu}{2,5}(?!\p{L})/u : /^\P{L}*(\p{Lu}\p{Ll}|\p{Lu}{2,5}(?!\p{L}))/u;
    return words.filter((word, i) => i > 0 && !/[.!?:]["”»]?$/u.test(words[i - 1]) && name.test(word)).map(plainWord).filter(Boolean);
};

// The proposal checked against the title: {text}, or {problem} naming the check it fails when it is not the title of the
// same news: an exclamation mark kept, a name or a figure added that neither the title nor the passages have, a name or
// a figure or a quotation of the title lost, a negation added or lost, a question made a statement or the opposite, longer
// than the title by more than two words or keeping less than half of it
export const checkRewrite = (title, proposal, passages = '') => {
    let text = typeof proposal === 'string' ? proposal.replace(/\s+/g, ' ').trim() : '';
    // a title the AI wrapped in quotation marks, unless the title itself begins with one
    if (/^["“«].*["”»]$/u.test(text) && !/^["“«„]/u.test(title)) text = text.slice(1, -1).trim();
    if (!text) return {problem: 'empty'};
    if (/[!¡]/u.test(text)) return {problem: 'exclamation'};
    const known = new Set(tokensOf(`${title} ${passages}`).map(plainWord));
    const given = numbersOf(`${title} ${passages}`);
    const proposed = numbersOf(text);
    if ([...proposed].some(number => !given.has(number))) return {problem: 'figure added'};
    if ([...numbersOf(title)].some(number => !proposed.has(number))) return {problem: 'figure lost'};
    if (namesOf(text).some(name => !known.has(name))) return {problem: 'name added'};
    // the first word is a name when it is long and capitalized and neither the title nor the passages have it
    const [opening] = tokensOf(text);
    if (!mostlyUpper(text) && !inTitleCase(text) && /^\P{L}*\p{Lu}/u.test(opening) && plainWord(opening).length >= 5 && !known.has(plainWord(opening))) return {problem: 'name added'};
    // a name is kept when a word of the proposal begins like it (« Barca » and « Barcelona », « Italian » and « Italy »)
    const stems = new Set(tokensOf(text).map(plainWord).filter(Boolean).map(word => word.slice(0, 4)));
    if (namesOf(title).some(name => !stems.has(name.slice(0, 4)))) return {problem: 'name lost'};
    if (hasNegation(title) !== hasNegation(text)) return {problem: 'negation'};
    if (/\?\s*$/u.test(title) !== /\?\s*$/u.test(text)) return {problem: 'question'};
    // what someone said stays word for word, its punctuation aside (the exclamation mark of a quotation may go)
    const letters = (span) => span.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    if (quotedSpans(title).some(([start, end]) => end - start > 4 && !letters(text).includes(letters(title.slice(start, end))))) return {problem: 'quotation changed'};
    const before = realWordsOf(title).length;
    const after = realWordsOf(text).length;
    if (after < MIN_WORDS_LEFT || after > before + 2 || after < before * REWRITE_MIN_SHARE) return {problem: 'length'};
    return {text: startsWithCapital(title) && !startsWithCapital(text) ? capitalized(text) : text};
};

// Thinking is on: on 45 real titles (bench/neutral-rewrite.mjs, 03.11.2026) it stays closer to the title (« Scandal in the
// VAR! Presence of outside people denounced » keeps « in the VAR », without it « SFV reacts » became « SFV announces new
// guidelines »), 8 proposals refused by the checks against 14, for 1.8k tokens a title instead of 25: one title asked for
// by a click of the reader, not one per card
//
// The title rewritten: {title} (the proposal, checked), {title: null, reason: 'same'} when the title is neutral as it
// is, {title: null, reason: 'unsafe', problem, proposal} when the proposal changes what the title says (the problem and
// the proposal are for the logs, not for the reader), and an error when the AI fails
export const rewrittenTitle = async (title, passages = '', usage = null, {language = null, think = true, timeoutMs} = {}) => {
    const answer = await ollamaJson(rewritePrompt(title, String(passages).slice(0, REWRITE_PASSAGES), language), usage, {think, timeoutMs});
    const tidyTitle = title.replace(/\s+/g, ' ').trim();
    // the title given back as it is, however short: neutral already
    if (typeof answer?.title === 'string' && answer.title.replace(/\s+/g, ' ').trim() === tidyTitle) return {title: null, reason: 'same'};
    const {text, problem} = checkRewrite(title, answer?.title, passages);
    if (problem) return {title: null, reason: 'unsafe', problem, proposal: typeof answer?.title === 'string' ? answer.title : null};
    return text === tidyTitle ? {title: null, reason: 'same'} : {title: text};
};

// Whether a title needs to be made neutral at all, asked of all the titles of a briefing at once before any is
// rewritten (the user, 03.11.2026: "que l'IA évalue s'il est nécessaire de changer avant de changer"). Measured in
// bench/neutral-gate.mjs
export const judgmentPrompt = (titles) => `Voici des titres d'articles d'actualité, chacun avec son numéro entre crochets, dans leur langue d'origine.

Pour chaque titre, dis s'il contient un JUGEMENT, une EMPHASE ou un APPEL AU CLIC du média : un adjectif ou adverbe d'opinion ou d'intensité (« incroyable », « honteux », « énorme », « enfin », « massive », « shocking »), un point d'exclamation d'emphase, un mot d'appel (« Urgent », « Choc », « Révélation »), une question faite pour attirer, un mot en majuscules d'insistance, un verbe de combat (« démolit », « slams »).
N'en ont pas : un titre qui dit un fait en termes simples (même grave ou important), un titre qui rapporte ce que quelqu'un a dit entre guillemets (le jugement est celui de la personne citée, pas du média), un nom de rubrique ou de statut (« Officiel », « Interview », « Live »), un titre en question qui demande vraiment quelque chose d'ouvert à l'actualité.
Dans le doute, le titre n'en a pas.

${titles.map((title, i) => `[${i + 1}] ${title}`).join('\n')}

Réponds uniquement en JSON, pour les seuls titres qui en ont : {"titles": [{"n": numéro, "words": ["mot ou groupe de mots en cause, copié tel quel"]}]}`;

// the titles that have some, only the ones given: Map index (from 0) -> [the words in cause]
export const normalizeJudged = (answer, count) => {
    const judged = new Map();
    for (const item of Array.isArray(answer?.titles) ? answer.titles : []) {
        const index = Number(String(item?.n ?? '').replace(/^\[|\]$/g, '')) - 1;
        if (!Number.isInteger(index) || index < 0 || index >= count || judged.has(index)) continue;
        judged.set(index, (Array.isArray(item?.words) ? item.words : []).filter(word => typeof word === 'string' && word.trim()).map(word => word.trim()));
    }
    return judged;
};

// titles: [title] -> Map index -> [words in cause] of the ones that need to be made neutral. Rejects when the AI fails
export const judgedTitles = async (titles, usage = null) =>
    titles.length === 0 ? new Map() : normalizeJudged(await ollamaJson(judgmentPrompt(titles), usage), titles.length);

// Whether a title rewritten still tells the same fact as the title it comes from, asked of all the pairs of a briefing at
// once: the second opinion that stands in for the reader of the editor when the rewrite is not shown first
export const sameFactPrompt = (pairs) => `Voici des paires de titres d'actualité : le titre A tel que publié, le titre B sa réécriture neutre. Chaque paire a son numéro entre crochets.

Pour chaque paire, dis si B dit EXACTEMENT le même fait que A, avec seulement moins de jugement, d'emphase ou d'appel au clic : mêmes acteurs, même action, mêmes chiffres, même degré de certitude (« aurait », « selon X », « pourrait »), une question restant une question.
Réponds non si B ajoute un fait, en retire un, change un acteur ou un verbe en un autre qui ne veut pas dire la même chose (« réagit » n'est pas « annonce », « raids » n'est pas « intervient »), rend plus ou moins certain, ou si B dit quelque chose que A ne dit pas. Dans le doute, non.

${pairs.map((pair, i) => `[${i + 1}]\nA : ${pair.title}\nB : ${pair.proposal}`).join('\n\n')}

Réponds uniquement en JSON : {"pairs": [{"n": numéro, "same": true ou false, "why": "ce qui diffère, en quelques mots, vide si same"}]}`;

// for each pair answered, whether it is the same fact: Map index (from 0) -> {same, why}. A pair not answered is left out
export const normalizeSameFact = (answer, count) => {
    const verdicts = new Map();
    for (const item of Array.isArray(answer?.pairs) ? answer.pairs : []) {
        const index = Number(String(item?.n ?? '').replace(/^\[|\]$/g, '')) - 1;
        if (!Number.isInteger(index) || index < 0 || index >= count || verdicts.has(index) || typeof item?.same !== 'boolean') continue;
        verdicts.set(index, {same: item.same, why: typeof item.why === 'string' ? item.why.trim() : ''});
    }
    return verdicts;
};

// pairs: [{title, proposal}] -> Map index -> {same, why}. Rejects when the AI fails
export const sameFact = async (pairs, usage = null, {think, timeoutMs} = {}) =>
    pairs.length === 0 ? new Map() : normalizeSameFact(await ollamaJson(sameFactPrompt(pairs), usage, {think, timeoutMs}), pairs.length);

// The titles of a briefing made neutral by the AI, by default (the user, 03.11.2026), in three steps measured on 300 real
// titles (bench/neutral-gate.mjs): the AI says which titles have a judgment, an emphasis or a call to click (26% of them,
// over-flagged and a few missed); those are rewritten, with the checks of the code; and a second opinion, thinking on,
// says whether the rewrite tells exactly the same fact. A rewrite is kept only when it says so: 22 titles of 300 changed,
// the 22 right by hand, the 28 mild or bad rewrites stopped. Any failure leaves the title as it is: a card never waits
// on it. entries: [{title, passages, language}] (language: its name, "German", for the rewrite to be written in it).
// Answers Map index -> the title rewritten, only for the ones kept
export const REWRITES_AT_ONCE = 4;
const JUDGED_AT_ONCE = 40;
const VERIFIED_AT_ONCE = 6;
const AI_TIMEOUT_MS = 240e3;
export const aiRewrittenTitles = async (entries, usage = {}) => {
    const kept = new Map();
    if (entries.length === 0 || process.env.AI_NEUTRAL_TITLES === 'off') return kept;
    const judged = new Set();
    await mapWithConcurrency(chunksOf(entries.map((entry, index) => index), JUDGED_AT_ONCE), REWRITES_AT_ONCE, async (indexes) => {
        try {
            for (const at of (await judgedTitles(indexes.map(index => entries[index].title), usage.judging)).keys()) judged.add(indexes[at]);
        } catch (err) {
            console.error(`Briefing: the titles were not judged (${err.message})`);
        }
    });
    const proposals = [];
    await mapWithConcurrency([...judged].sort((a, b) => a - b), REWRITES_AT_ONCE, async (index) => {
        try {
            const answer = await rewrittenTitle(entries[index].title, entries[index].passages, usage.rewriting, {language: entries[index].language, timeoutMs: AI_TIMEOUT_MS});
            if (answer.title) proposals.push({index, proposal: answer.title});
        } catch (err) {
            console.error(`Briefing: a title was not rewritten (${err.message})`);
        }
    });
    await mapWithConcurrency(chunksOf(proposals.sort((a, b) => a.index - b.index), VERIFIED_AT_ONCE), REWRITES_AT_ONCE, async (batch) => {
        try {
            const verdicts = await sameFact(batch.map(({index, proposal}) => ({title: entries[index].title, proposal})), usage.verifying, {think: true, timeoutMs: AI_TIMEOUT_MS});
            batch.forEach(({index, proposal}, at) => { if (verdicts.get(at)?.same === true) kept.set(index, proposal); });
        } catch (err) {
            console.error(`Briefing: the titles rewritten were not verified (${err.message})`);
        }
    });
    return kept;
};

const chunksOf = (list, size) => Array.from({length: Math.ceil(list.length / size)}, (_, i) => list.slice(i * size, (i + 1) * size));

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
