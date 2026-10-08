//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: wikidata-names.js
//  Description: What an item of Wikidata is, and the names its news are found by. Pure
//

"use strict"

const QID = /^Q[1-9]\d{0,11}$/;
export const isQid = (value) => typeof value === 'string' && QID.test(value);

// what an item is, told by its "instance of" (P31): the page and the links read for it depend on it
const KINDS = [
    ['person', ['Q5']],
    ['club', ['Q476028', 'Q847017', 'Q103229495', 'Q12973014', 'Q13393265', 'Q1194951']],
    ['team', ['Q6979593', 'Q23905105', 'Q1194951']],
    ['competition', ['Q15991303', 'Q500834', 'Q1478437', 'Q27020041', 'Q623109', 'Q13406554', 'Q2990963']],
    ['organisation', ['Q43229', 'Q4830453', 'Q15911314', 'Q484652', 'Q7210356', 'Q163740', 'Q891723', 'Q6881511', 'Q783794', 'Q2085381', 'Q4438121', 'Q1785733']],
];
export const kindOf = (instanceOf) => KINDS.find(([, ids]) => ids.some(id => instanceOf.includes(id)))?.[0] ?? 'other';

// The names its news are found by. Wikidata gives Paris Saint-Germain the alias "Paris": a single
// common word would bring every news of the city. A name of one word is kept only when it is an
// acronym ("PSG", "UEFA") or carries a figure ("Schalke 04"); the reader adds and takes out the others
export const usableName = (name) => {
    const text = String(name ?? '').trim();
    if (text.length < 2 || text.length > 80) return false;
    if (/\s/.test(text)) return true;
    return /^[A-Z0-9][A-Z0-9.&-]{1,9}$/.test(text) && /[A-Z]/.test(text) || /\d/.test(text);
};

// a club named without its "FC": Wikidata knows Paris Saint-Germain as "PSG F.C.", never as "PSG"
const CLUB_WORDS = /(^|\s)(F\.?C\.?|A\.?F\.?C\.?|C\.?F\.?|S\.?C\.?|A\.?C\.?)(?=\s|$)/g;
export const withoutClubWords = (name) => name.replace(CLUB_WORDS, ' ').replace(/\s+/g, ' ').trim();

// the news read are in latin letters: "ΟΥΕΦΑ" or "欧足联" would find none
const LATIN = /^[\p{Script=Latin}\p{Number}\s.,'’&()/+-]+$/u;

// the names of an item, once each whatever their case: its labels and the aliases kept. club: the
// names without "FC" are names too
export const namesOf = (labels, aliases, extra = [], {club = false} = {}) => {
    const seen = new Set();
    const names = [];
    const all = [...labels, ...extra, ...aliases.filter(usableName)];
    const shortened = club ? all.map(withoutClubWords).filter(usableName) : [];
    for (const name of [...all, ...shortened]) {
        const text = String(name ?? '').trim();
        const key = text.toLowerCase();
        if (!text || !LATIN.test(text) || seen.has(key)) continue;
        seen.add(key);
        names.push(text);
    }
    return names;
};
