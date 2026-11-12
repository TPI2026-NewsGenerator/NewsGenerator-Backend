//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: fifa-site.js
//  Description: The president of an association as the public page of FIFA gives it (inside.fifa.com/en/associations/{code}/organisation, allowed by its robots.txt,
//               which closes only /api/): the page holds its data as JSON (__NEXT_DATA__), the president under pageData.hero.association.president and the officers
//               under pageData.organizationIntroSectionProps.organization.members with their roles. Pure: the page comes in, the name goes out
//

"use strict"

import {mentionKey} from './mentions.js';

export const pageUrl = (code) => `https://inside.fifa.com/en/associations/${encodeURIComponent(code)}/organisation`;

// "Said ATHOUMAN" -> "Said Athouman", "Cindy Parlow CONE" -> "Cindy Parlow Cone": FIFA writes the surname in capitals; a name already in lower case stays as it is
const SMALL = new Set(['bin', 'ben', 'al', 'el', 'de', 'da', 'do', 'dos', 'van', 'von', 'der', 'den', 'di', 'du', 'la', 'le', 'abu', 'ibn', 'bint', 'of']);
export const niceName = (name) => String(name ?? '').replace(/\s+/g, ' ').trim().split(' ').map((word, at, words) => {
    // initials ("J.T.") stay as they are
    if (word.length < 2 || word !== word.toUpperCase() || !/\p{L}/u.test(word) || word.includes('.')) return word;
    const lower = word.toLowerCase();
    // a hyphenated or apostrophe name keeps its parts: "AL-KHALIFA" -> "Al-Khalifa", "O'NEILL" -> "O'Neill"
    // a small word is a particle only between the first and the last word ("Jan DEN BOER"): "Person DEN" has the surname "Den"
    return SMALL.has(lower) && at > 0 && at < words.length - 1 ? lower : lower.replace(/(^|[-'’])(\p{L})/gu, (all, edge, letter) => edge + letter.toUpperCase());
}).join(' ');

// whether two names are one person's: they share a word of three letters or more once the accents, the case and the capitals are gone
// ("Said ATHOUMAN" and "Saïd Athouman"; "Hany Abo Rida" and "Hany Abou Rida" share "hany" and "rida")
export const sameName = (a, b) => {
    const words = (name) => mentionKey(name).split(' ').filter(word => word.length > 2);
    const known = new Set(words(a));
    return words(b).some(word => known.has(word));
};

// {name, officers: [{name, roles}]} of a page of FIFA, null when the page holds no president (a page that is not one of an association, or a body with none named)
export const leaderOfPage = (html) => {
    const found = String(html ?? '').match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!found) return null;
    let data;
    try {
        data = JSON.parse(found[1]);
    } catch {
        return null;
    }
    const page = data?.props?.pageProps?.association?.pageData;
    const officers = (page?.organizationIntroSectionProps?.organization?.members ?? [])
        .filter(member => typeof member?.name === 'string').map(member => ({name: niceName(member.name), roles: Array.isArray(member.roles) ? member.roles : []}));
    const named = page?.hero?.association?.president?.value;
    const name = typeof named === 'string' && named.trim() !== '' ? niceName(named)
        : officers.find(officer => officer.roles.some(role => /^president$/i.test(String(role).trim())))?.name ?? null;
    return name ? {name, officers} : null;
};
