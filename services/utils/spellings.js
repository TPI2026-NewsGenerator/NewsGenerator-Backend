//
//  Author: Fabian Rostello
//  Date: 02.11.2026
//  File: spellings.js
//  Description: How the names of a card are spelled once translated. The AI turns "Φραπάρ" into "Frapar"
//               in a title and "Stéphanie Frappart" in the text of the same card (briefings 252 and 253 of
//               27.10.2026): it has to guess a Latin spelling for a name written in Greek, and guesses
//               better with a first name and a sentence than with a word alone. The spellings the card
//               already has (its translated text, the labels of Wikidata of the names its news name) are
//               told to the translations that come after, and a word of a translation a letter or two off
//               one of them is put back as they spell it
//

"use strict"

// "Stéphanie" and "Stephanie" are one word here
const plain = (word) => word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const WORD = /\p{L}(?:[\p{L}\p{M}'’-]*\p{L})?/gu;
const capital = (word) => /^\p{Lu}/u.test(word);
// a word of the Latin alphabet: the names a Greek or a Cyrillic text is translated to, not the ones it was written in
const LATIN_WORD = /^[\p{Script=Latin}\p{M}'’-]+$/u;
const POSSESSIVE = /['’]s$/i;
const STARTS_SENTENCE = /(?:^|[.!?…:;»"“”()\n]\s*)$/u;
const MIN_LENGTH = 5;
// the letters a spelling adds to another when the names are one: a doubled or a dropped consonant
// (Frappart / Frapar, Bozhinovski / Bozinovski). A vowel is another name (Stéphane / Stéphanie)
const CONSONANTS = new Set('bcdfghjklmnpqrstvwxz');

// [{word, at, starts}] of a text: the words, where they begin, whether a sentence begins with them
const wordsOf = (text) => [...String(text ?? '').matchAll(WORD)].map(match => ({
    word: match[0].replace(POSSESSIVE, ''),
    at: match.index,
    length: match[0].length,
    starts: STARTS_SENTENCE.test(text.slice(0, match.index)),
}));

// The names a text writes, the ones written in the Latin alphabet: runs of capitalized words ("Stéphanie
// Frappart"), never the word that opens a sentence ("Later Frappart" is no name), the most met first. Not
// more than 'max'
export const namesIn = (text, max = 20) => {
    const words = wordsOf(text);
    const counts = new Map();
    for (let i = 0; i < words.length;) {
        const run = [];
        let j = i;
        // the words of a run are separated by a space alone
        while (j < words.length && capital(words[j].word) && LATIN_WORD.test(words[j].word) && !words[j].starts
            && (j === i || /^ $/.test(text.slice(words[j - 1].at + words[j - 1].length, words[j].at)))) {
            run.push(words[j]);
            j++;
        }
        i = Math.max(j, i + 1);
        if (run.length === 0 || (run.length === 1 && run[0].word.length < 3)) continue;
        const name = run.map(entry => entry.word).join(' ');
        counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]).map(([name]) => name).slice(0, max);
};

// whether 'short' is 'long' with letters left out, all of them consonants, and neither starts the other
// (a word cut short, a name declined: "Meravigli" is no spelling of "Meraviglia")
const dropsConsonants = (short, long) => {
    if (short.length >= long.length || long.startsWith(short) || short.startsWith(long)) return false;
    let at = 0;
    for (const letter of long) {
        if (at < short.length && short[at] === letter) at++;
        else if (!CONSONANTS.has(letter)) return false;
    }
    return at === short.length;
};

// The text with the words that are a spelling of a name of 'names' put as it spells them: only a capitalized
// word of five letters or more that the names do not have, the original does not write as it is, and
// that is one of them with a doubled or a dropped consonant; and only when one of the names fits.
// names: ["Stéphanie Frappart", "Thessaloniki"], original: the text translated (a name it writes in the
// Latin alphabet stays as its source spells it)
export const alignNames = (text, names, original = '') => {
    if (!text || !names?.length) return text;
    const targets = new Map();
    for (const name of names) {
        for (const {word} of wordsOf(name)) {
            if (capital(word) && LATIN_WORD.test(word) && plain(word).length >= MIN_LENGTH) targets.set(plain(word), word);
        }
    }
    if (targets.size === 0) return text;
    const written = new Set(wordsOf(original).map(({word}) => plain(word)));
    let result = '';
    let from = 0;
    for (const {word, at, length} of wordsOf(text)) {
        const key = plain(word);
        if (!capital(word) || key.length < MIN_LENGTH || targets.has(key) || written.has(key)) continue;
        const fits = [...targets].filter(([target]) => Math.abs(target.length - key.length) <= 2
            && (dropsConsonants(key, target) || dropsConsonants(target, key)));
        if (fits.length !== 1) continue;
        result += text.slice(from, at) + fits[0][1] + text.slice(at + word.length, at + length);
        from = at + length;
    }
    return result + text.slice(from);
};

const MAX_GLOSSARY = 12;

// What the translation of a text is told about the spelling of its names, "" when there is nothing to tell.
// glossary: [{written, spelled}], the names of the news as they are written and as Wikidata spells them;
// names: the names the translated text of the card already writes
// It settles a spelling and adds nothing: told "Stéphanie Frappart", the AI wrote it in full for a title that
// only had "Φραπάρ" (bench/spellings-replay.mjs)
const SPELLING_ONLY = 'Only the spelling: write the words the text writes, a family name alone stays a family name.';
export const spellingNote = ({glossary = [], names = []} = {}) => [
    glossary.length > 0 ? `Wikidata spells these names: ${glossary.slice(0, MAX_GLOSSARY)
        .map(({written, spelled}) => `“${written}” is ${spelled}`).join('; ')}. When the text names one, spell it so.` : '',
    names.length > 0 ? `The same card already spells ${names.slice(0, MAX_GLOSSARY).join(', ')}: when the text names one, spell it so.` : '',
    glossary.length + names.length > 0 ? SPELLING_ONLY : '',
].filter(Boolean).join(' ');

// every spelling a card has, to align a translation with: the words of its names and of the labels of Wikidata
export const spellingsOf = ({glossary = [], names = []} = {}) => [...names, ...glossary.map(({spelled}) => spelled)];
