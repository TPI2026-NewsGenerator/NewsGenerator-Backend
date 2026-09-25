//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: corroboration.js
//  Description: How many media tell a story, and how many of them wrote it themselves
//

"use strict"

// Ten media republishing the same wire of the AFP are one report seen ten times, not ten
// confirmations. The titles can't tell it: a paper rewrites the title of a wire and keeps its text.
// So the texts are compared, once read: two texts sharing most of their sequences of eight words are
// the same copy. And the wire itself often says whose it is ("avec AFP", "(Reuters)").
const SHINGLE_WORDS = 8;
const SAME_COPY = 0.5;          // share of the shorter text found in the other
const MIN_WORDS = 60;           // under this (a description, a paywall) a text can't be compared

// the agencies a text credits, as their name is written in their wires
const AGENCIES = [
    ['AFP', /\bAFP\b|Agence France[- ]Presse/],
    ['Reuters', /\bReuters\b/],
    ['AP', /\(AP\)|\bAssociated Press\b/],
    ['ATS', /\b(Keystone-)?ATS\b/],
    ['Belga', /\bBelga\b/],
    ['ANSA', /\bANSA\b/],
    ['EFE', /\bEFE\b/],
    ['dpa', /\bdpa\b/],
    ['PA Media', /\bPA Media\b/],
];

const words = (text) => (text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

export const shingles = (text) => {
    const list = words(text);
    const set = new Set();
    for (let i = 0; i + SHINGLE_WORDS <= list.length; i++) set.add(list.slice(i, i + SHINGLE_WORDS).join(' '));
    return set;
};

// the share of the smaller set found in the other
export const containment = (a, b) => {
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    if (small.size === 0) return 0;
    let shared = 0;
    for (const shingle of small) if (large.has(shingle)) shared++;
    return shared / small.size;
};

export const agenciesOf = (...texts) => {
    const text = texts.filter(Boolean).join('\n');
    return AGENCIES.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
};

// articles: [{medium, text, byline}], every article of the story (text: the body when it was read,
// null when it was not). Returns:
//   media: how many media tell the story
//   read: how many of their texts could be read and compared
//   independent: how many of the read texts were written apart from the others (never above the
//                media read: a medium writing twice about it is still one voice)
//   agencies: the agencies the read texts credit
export const corroborationOf = (articles) => {
    const media = new Set(articles.map(article => article.medium));
    const read = articles.filter(article => words(article.text).length >= MIN_WORDS);

    // same copy is transitive: A is B word for word and B is C, so A is C
    const sets = read.map(article => shingles(article.text));
    const group = read.map((_, i) => i);
    const find = (i) => group[i] === i ? i : (group[i] = find(group[i]));
    for (let i = 0; i < read.length; i++) {
        for (let j = i + 1; j < read.length; j++) {
            if (containment(sets[i], sets[j]) >= SAME_COPY) group[find(j)] = find(i);
        }
    }
    const copies = new Set(read.map((_, i) => find(i)));
    const readMedia = new Set(read.map(article => article.medium));

    return {
        media: media.size,
        read: readMedia.size,
        independent: Math.min(copies.size, readMedia.size),
        agencies: [...new Set(read.flatMap(article => agenciesOf(article.byline, article.text)))],
    };
};
