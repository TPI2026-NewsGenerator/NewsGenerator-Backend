//
//  Author: Fabian Rostello
//  Date: 18.10.2026
//  File: countries.js
//  Description: The countries a card is of, from who and where its articles name: "Hichilema dismisses
//               his minister" tells nothing to a reader who does not know he is the president of Zambia
//               (an idea of a friend of the user, 18.10.2026). Several when its names are of several
//               (Trump and Xi: the United States and China)
//

"use strict"

import {MentionModel} from '../../models/mention-model.js';
import {readCountries} from './wikidata.js';

// the countries shown at most, and how much of the first one's weight another one needs
export const MAX_COUNTRIES = 3;
const SHARE_OF_FIRST = 0.5;

// The codes ISO 3166-1 of the countries of a card ("ZM"), the main first. items: [{qid, weight, person}],
// who and where it names, weight the news of the card naming them; of: Map qid -> {country,
// international, bodies, media}. Each item counts once, with its weight; a country is shown when it weighs half
// the first at least: a card on Trump and Xi is of the United States and China, a card on Hichilema in
// Lusaka of Zambia only. The people of an international body the card names are not of their country:
// Infantino of FIFA, Motsepe of the CAF are no Swiss nor South African news. The other people are: the
// Romanian referee of a UEFA match, Wenger running against Infantino (measured 19.10.2026 on 173 cards
// naming such a body, bench/international-people: 79 right of 84 where it changes something, 46 when
// every person of these cards was left out). A news medium it names is its source, not what it is about:
// "L'Équipe: Burleanu could be UEFA's candidate", told by Romanian media, is a card of Romania, not of
// France (the user, 03.11.2026). Its country counts only when nothing else gives one: a card of the
// Tunisian press naming "La Presse de Tunisie" only keeps Tunisia (measured on 529 cards of 14 days: of the
// 12 naming a medium, 3 showed the country of the medium and it was not the card's, 2 (one card in two
// briefings) lose an Italian one that was right, said by Corriere dello Sport)
export const cardCountries = (items, of) => {
    const weights = new Map();
    for (const {qid, weight, person} of items) {
        if (qid) weights.set(qid, {weight: Math.max(weights.get(qid)?.weight ?? 0, weight), person: Boolean(person)});
    }
    const international = new Set([...weights.keys()].filter(qid => of.get(qid)?.international));
    const ofBody = (qid) => (of.get(qid)?.bodies ?? []).some(body => international.has(body));
    const scores = new Map();
    const ofMedia = new Map();
    for (const [qid, {weight, person}] of weights) {
        const code = of.get(qid)?.country;
        if (!code || (person && ofBody(qid))) continue;
        const into = of.get(qid)?.media ? ofMedia : scores;
        into.set(code, (into.get(code) ?? 0) + weight);
    }
    const ranked = [...(scores.size > 0 ? scores : ofMedia)].sort((a, b) => b[1] - a[1]);
    return ranked.filter(([, score]) => score >= ranked[0][1] * SHARE_OF_FIRST).slice(0, MAX_COUNTRIES).map(([code]) => code);
};

// Why a card has no country, for the audit of a briefing (scripts/briefing-audit.js): the first of these that holds. names: [{name,
// qid, kind}] the card shows; of: Map qid -> {country, international, bodies, media} as countriesOfItems answers (the rows of the
// database only: nothing is asked of Wikidata)
export const NO_COUNTRY_BECAUSE = {
    noName: 'the card has no name',
    unlinked: 'its names are linked to no item of Wikidata',
    international: 'its names are international bodies and their people',
    notRead: 'the country of a name linked was not read yet',
    noneKnown: 'the names linked have no country (people without one, things)',
    refused: 'the rules gave a country and the AI kept none of them',
};
export const whyNoCountry = (names, of) => {
    if (!names?.length) return 'noName';
    const linked = names.filter(name => name.qid && !name.qid.startsWith('country:'));
    if (linked.length === 0) return 'unlinked';
    if (cardCountries(linked.map(name => ({qid: name.qid, weight: 1, person: name.kind === 'person'})), of).length > 0) return 'refused';
    if (linked.some(name => of.get(name.qid)?.international)) return 'international';
    if (linked.some(name => !of.has(name.qid))) return 'notRead';
    return 'noneKnown';
};

// a row of item_countries as countriesOfItems and the audit read it
export const countryInfoOf = (row) => ({country: row.country, international: row.international, bodies: row.bodies ?? [], media: Boolean(row.media)});

// the items asked for to Wikidata at once, kept before the next ones; and how long a card waits for
// Wikidata to answer again: the server linking names shares its address and is refused at times
// (18.10.2026), and the AI writing the cards takes longer anyway
const ITEMS_AT_ONCE = 40;
const MAX_WAIT_MS = 30e3;
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Map qid -> {country, international, bodies, media} of these items (see readCountries): the ones read before
// from the database, the others from Wikidata now, kept. The ones read before their bodies were
// (19.10.2026), or before we knew whether they are news media (3.11.2026), are read again, kept as they were
// until then (not while db/add_item_media.sql is not applied: the rows have no media then). Wikidata refusing for longer, or failing:
// the ones read so far only. background: read ahead, no reader waiting (see wikidata.js MAX_LAG_S)
export const countriesOfItems = async (qids, {background = false} = {}) => {
    const asked = [...new Set(qids.filter(Boolean))];
    const rows = await MentionModel.countriesOf(asked);
    const known = new Map(rows.map(row => [row.qid, countryInfoOf(row)]));
    const current = new Set(rows.filter(row => row.bodies && row.media !== null).map(row => row.qid));
    const missing = asked.filter(qid => !current.has(qid));
    let waited = 0;
    for (let i = 0; i < missing.length;) {
        const part = missing.slice(i, i + ITEMS_AT_ONCE);
        try {
            const read = await readCountries(part, {background});
            await MentionModel.saveCountries([...read].map(([qid, country]) => ({qid, ...country})));
            read.forEach((country, qid) => known.set(qid, country));
            i += ITEMS_AT_ONCE;
        } catch (err) {
            if (err.paused && waited + err.retryIn <= MAX_WAIT_MS) {
                waited += err.retryIn + 1000;
                await wait(err.retryIn + 1000);
                continue;
            }
            console.error(`Countries: ${missing.length - i} items not read from Wikidata (${err.message})`);
            break;
        }
    }
    return known;
};
