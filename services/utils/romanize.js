//
//  Author: Fabian Rostello
//  Date: 07.11.2026
//  File: romanize.js
//  Description: A name written in Greek or Cyrillic letters in Latin letters, to find the person it is among the persons linked to an item
//               of Wikidata. "Τζιάνι Ινφαντίνο" is what the Greek press writes of Gianni Infantino, Wikidata has "Τζάνι Ινφαντίνο": no
//               search finds it, and the card lost its person and its country (the briefing 444, 6.11.2026). The Latin letters of its
//               family name are the ones of the person linked ("Infantino"). A letter that two spellings share (the "ντ" of Greek is "nt"
//               in Infantino and "d" in Ronaldo) gives each of them: the spellings are the ones to look for, never one to show
//

"use strict"

// the letters of Greek, a pair of them first: [the spellings, the first the usual one]
const GREEK_TWO = {
    'ντ': ['nt', 'd'], 'μπ': ['mb', 'b'], 'γκ': ['g', 'gk'], 'γγ': ['ng', 'g'], 'τζ': ['tz', 'j'], 'τσ': ['ts'],
    'ου': ['u', 'ou'], 'ει': ['i', 'ei'], 'οι': ['i', 'oi'], 'αι': ['e', 'ai'],
};
const GREEK_ONE = {
    α: ['a'], β: ['v'], γ: ['g'], δ: ['d'], ε: ['e'], ζ: ['z'], η: ['i'], θ: ['th'], ι: ['i'], κ: ['k'], λ: ['l'], μ: ['m'], ν: ['n'], ξ: ['x'],
    ο: ['o'], π: ['p'], ρ: ['r'], σ: ['s'], ς: ['s'], τ: ['t'], υ: ['y', 'u'], φ: ['f'], χ: ['ch'], ψ: ['ps'], ω: ['o'],
};
// Russian, Ukrainian, Bulgarian, Serbian and Macedonian: the marks of й, ё and ї are taken off before (и, е and і)
const CYRILLIC_TWO = {'дж': ['j', 'dzh']};
const CYRILLIC_ONE = {
    а: ['a'], б: ['b'], в: ['v'], г: ['g'], д: ['d'], е: ['e'], ж: ['zh', 'j'], з: ['z'], и: ['i'], к: ['k'], л: ['l'], м: ['m'], н: ['n'], о: ['o'],
    п: ['p'], р: ['r'], с: ['s'], т: ['t'], у: ['u'], ф: ['f'], х: ['h', 'kh'], ц: ['ts', 'c'], ч: ['ch'], ш: ['sh'], щ: ['shch', 'sh'], ъ: [''], ы: ['y', 'i'],
    ь: [''], э: ['e'], ю: ['u', 'yu'], я: ['a', 'ya'], і: ['i'], є: ['e', 'ye'], ґ: ['g'], ђ: ['dj', 'd'], ј: ['j'], љ: ['lj'], њ: ['nj'], ћ: ['c'], џ: ['dz'],
    ѓ: ['gj', 'g'], ѕ: ['dz'], ќ: ['kj', 'k'],
};

const MAX_SPELLINGS = 24;

// The Latin spellings of a name written in Greek or Cyrillic letters (and Latin ones, left as they are): the usual one, then each of
// the others a pair of letters allows one at a time, then all of them. [] for a name that is not in Greek or Cyrillic, or that has the
// letters of another script (Arabic, Hebrew, Chinese: no spelling of them is a name)
export const romanizations = (text) => {
    const lower = String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const letters = lower.match(/\p{L}/gu) ?? [];
    if (!letters.some(letter => /[\p{Script=Greek}\p{Script=Cyrillic}]/u.test(letter))) return [];
    if (letters.some(letter => !/[\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Latin}]/u.test(letter))) return [];
    const units = [];
    for (let at = 0; at < lower.length;) {
        const pair = lower.slice(at, at + 2);
        if (GREEK_TWO[pair]) units.push(GREEK_TWO[pair]);
        else if (CYRILLIC_TWO[pair]) units.push(CYRILLIC_TWO[pair]);
        if (GREEK_TWO[pair] || CYRILLIC_TWO[pair]) {
            at += 2;
            continue;
        }
        const one = lower[at];
        units.push(GREEK_ONE[one] ?? CYRILLIC_ONE[one] ?? [one]);
        at += 1;
    }
    const join = (pick) => units.map((options, i) => options[pick(options, i)] ?? options[0]).join('');
    // every combination when there are few of them ("Γκερντ Μύλερ": γκ, ντ and υ have two each), else the usual one, each other one at a
    // time and all the others together
    const combinations = units.reduce((count, options) => count * options.length, 1);
    if (combinations <= MAX_SPELLINGS) {
        const all = [];
        for (let n = 0; n < combinations; n++) {
            let rest = n;
            all.push(units.map(options => { const option = options[rest % options.length]; rest = Math.floor(rest / options.length); return option; }).join(''));
        }
        return [...new Set(all)];
    }
    const spellings = new Set([join(() => 0)]);
    units.forEach((options, unit) => {
        for (let other = 1; other < options.length; other++) spellings.add(join((_, i) => i === unit ? other : 0));
    });
    spellings.add(join(options => options.length > 1 ? 1 : 0));
    return [...spellings].slice(0, MAX_SPELLINGS);
};

// a word with its doubled letters as one ("messi" and "mesi", "gianni" and "giani"): the spellings of a name in other letters rarely
// keep them (the same function is in the SQL of MentionModel.personsByLooseSurname)
export const collapsed = (word) => String(word ?? '').replace(/(.)\1/g, '$1');

const distance = (a, b) => {
    const row = Array.from({length: b.length + 1}, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let diagonal = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const above = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
            diagonal = above;
        }
    }
    return row[b.length];
};

// whether two given names may be one: as written with other letters, at most half of their letters apart, doubled letters aside; an
// initial ("c" of "C. Ronaldo") is the beginning of the name it stands for
export const sameGivenName = (a, b) => {
    const [x, y] = [collapsed(a), collapsed(b)];
    if (!x || !y) return false;
    if ((x.length <= 2 || y.length <= 2) && (x.startsWith(y) || y.startsWith(x))) return true;
    return distance(x, y) <= Math.ceil(Math.max(x.length, y.length) / 2);
};
