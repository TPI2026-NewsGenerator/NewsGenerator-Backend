//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: football-associations.js
//  Description: The football associations of FIFA as items of Wikidata with the code of their country (the table is made by
//               scripts/build-football-associations.js): the filter "country" of /api/v1/news is the items of Wikidata
//               their news name. A code of two letters is a country or a territory ("JP", "BM"), "GB" is also the four
//               nations of the United Kingdom, each with its own code of ISO 3166-2 ("GB-WLS")
//

"use strict"

import {readFileSync} from 'node:fs';
import {countryNamed} from './country-names.js';
import {nationalityOf} from './nationalities.js';

const TABLE = JSON.parse(readFileSync(new URL('./football-associations.json', import.meta.url), 'utf8'));

// the codes of a country the filter takes: "JP", "GB", "GB-WLS"
export const COUNTRY_CODE = /^[A-Z]{2}(-[A-Z]{3})?$/;

// the associations of a country, [{qid, name, country}], none for a code that has none. "GB" gives the four nations too
export const associationsOfCountry = (code) => TABLE.filter(item => item.level === 'association' && item.country !== null
    && (item.country === code || item.country.startsWith(`${code}-`)));

export const associationNames = () => new Map(TABLE.map(item => [item.qid, item.name]));

// The name of an association the press writes with the name of its country: "Japan FA", "Portugal's soccer federation", "U.S. Soccer
// federation", "Portuguese football federation". Wikidata calls them by their own name ("Japan Football Association", "Portuguese
// Football Federation"), so the tagger found these names and the link left them with no item: 494 of the 1 661 mentions of the names of
// this shape in the database were, "Japan FA" 85 times, "Portugal FA" 101, and the friend's route by country missed their news (measured
// 11.11.2026, bench/federations/country-fa.mjs). Only "FA" and the football bodies, not "FF" (the Swedish clubs: Kalmar FF) nor a cup
// ("Jordan FA Cup"): the name ends with the body
const BODY = /^(.+?)(?:['’]s)? (?:FA|football association|football federation|soccer federation|soccer association)$/i;

// The country's name alone says which association is meant when the country has one in the table. Left out:
//  - Ireland: the "Irish FA" of the English press is the association of Northern Ireland, the Republic has the FAI (625 news of the
//    first, 421 of "Irish Football Association" linked to Northern Ireland): no way to choose
//  - the United Kingdom: four associations (associationsOfCountry gives them all); the Wikidata search finds those by their own names
//  - the two Congos: the press writes "Congo" for the one and the other
// And the adjective ("Portuguese FA", "Spanish football federation") is read for any country but the ones whose own football is another
// sport: "American football federation" is gridiron, "Australian football association" the Australian rules, "Canadian" the Canadian
const DOUBTFUL = new Set(['IE', 'CG', 'CD']);
const FOOTBALL_IS_ANOTHER_SPORT = new Set(['US', 'CA', 'AU']);

// The bare word of an association ("FA", "Football Association"), written with no country, says nothing alone: on the 371 news of 30 days that write "FA" and no
// longer name holding it (bench/acronym-types, 11.11.2026), about 40% are British media and aggregators in English (the English association), about 25% Spanish media
// of Uruguay and Chile (the Frente Amplio, a political party), a few Football Australia, the Egyptian association... So it has no item of its own, and the card,
// which sees the titles and the countries of its media, chooses (see MentionModel.setCandidates, withNamesLinked) among what it is offered. Wikidata offers the
// wrong ones for "FA" (a badge of Wikipedia, a village of the Aude) and the sport and the federation of Norway first for "Football Association": the English
// association is offered first; when the card is not about it, the AI answers none
const ENGLISH_FA = 'Q9500';
const BARE = new Set(['fa', 'football association']);
export const bareAssociationCandidates = (name) => BARE.has(String(name ?? '').trim().toLowerCase()) ? [ENGLISH_FA] : [];

// the item of the association a name says, null when it says none or can't tell between several
export const associationNamed = (name) => {
    // the headline of a news agency starts with its sport ("Soccer-Japan FA says..."), the tagger keeps it in the name
    const found = BODY.exec(String(name ?? '').trim().replace(/^(?:soccer|football)-/i, ''));
    if (!found) return null;
    const country = countryNamed(found[1]);
    // an adjective of nationality is one word ("Swiss", "Portuguese"): two words, or a hyphen, are a club or a body of its own
    const code = country ?? (/^[^\s-]+$/.test(found[1]) ? nationalityOf(found[1]) : null);
    if (!code || DOUBTFUL.has(code) || (!country && FOOTBALL_IS_ANOTHER_SPORT.has(code))) return null;
    const associations = associationsOfCountry(code);
    return associations.length === 1 ? associations[0].qid : null;
};

// ---- the acronyms of the associations (11.11.2026)
// The news write the associations by their acronym: "FKF" of Kenya (144 news of 30 days), "SAFA" of South Africa (149), "AUF" of Uruguay (94), "FPF" of Portugal (894),
// "TCIFA" of the Turks and Caicos Islands, and the tagger found them as organisations that Wikidata left with no item (69 of them in the database, 4 597 news: the
// card showed no country, or the one of the media). The acronyms are the ones Wikidata has (the field "acronyms" of the table, see scripts/build-football-associations.js:
// "SAFA", "PSSI", "FEF") and the initials of the name it gives the association ("Football Kenya Federation" is "FKF"), for the ones it has none of. The initials of a name
// Wikidata gives in another language than English are not the acronym the press uses ("Federação Santomense de Futebol" gives "FSF", the Senegalese federation's), which is
// one more reason to take an acronym only with the country of the sites to confirm it (see associationOfAcronym). Left out: an acronym of less than three letters ("FA", "AS", "UD": the bare words, see bareAssociationCandidates and acronymsOf) and the ones of the
// confederations, which are no association of a country
const SMALL_WORDS = new Set(['of', 'and', 'the', 'de', 'du', 'des', 'la', 'le', 'el', 'y', 'e', 'di', 'da', 'for', 'in']);
const CONFEDERATIONS = new Set(['AFC', 'CAF', 'OFC', 'UEFA', 'FIFA', 'CONMEBOL', 'CONCACAF', 'FA']);
const ACRONYM_FORM = /^[A-Z][A-Za-z0-9]{2,7}$/;
const initialsOf = (name) => name.replace(/[,.'’()]/g, ' ').split(/\s+/)
    .filter(word => word && !SMALL_WORDS.has(word.toLowerCase())).map(word => word.normalize('NFD')[0].toUpperCase()).join('');

let byAcronym = null;
const acronymTable = () => {
    if (byAcronym) return byAcronym;
    byAcronym = new Map();
    for (const item of TABLE.filter(one => one.level === 'association' && one.country !== null)) {
        for (const acronym of new Set([...(item.acronyms ?? []), initialsOf(item.name)])) {
            if (!ACRONYM_FORM.test(acronym) || CONFEDERATIONS.has(acronym)) continue;
            byAcronym.set(acronym, [...(byAcronym.get(acronym) ?? []), item]);
        }
    }
    return byAcronym;
};

// The associations an acronym stands for, [{qid, name, country}], none for a name that is no acronym of one
export const associationsOfAcronym = (name) => acronymTable().get(String(name ?? '').trim()) ?? [];

// The item of the association an acronym of the news stands for, null when it says none. Several associations have the same acronym ("JFA" of Japan and Jordan, "FPF"
// of Peru, Portugal and Puerto Rico, "GFA" of six): the country of the sites that write it tells, the one of most of them (see mediaOf of country-names.js): the association
// of that country when there is one, none when there is none or when two have it (the "AFM" of the Dutch sites is the authority of the financial markets, and "FAT" of the
// Vietnamese sites no Thai association). With no country of the sites, the association of an acronym of one only is given, and it is no more than a candidate: the same
// string names every body that bears it ("CSA", "FSF", "TFA"), so organizationItem offers it to the card that chooses from its titles and never links the name to it
export const associationOfAcronym = (name, country = null) => {
    const found = associationsOfAcronym(name);
    if (found.length === 0) return null;
    if (country) {
        const own = found.filter(item => item.country === country || item.country.startsWith(`${country}-`));
        return own.length === 1 ? own[0].qid : null;
    }
    return found.length === 1 ? found[0].qid : null;
};
