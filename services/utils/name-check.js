//
//  Author: Fabian Rostello
//  Date: 21.10.2026
//  File: name-check.js
//  Description: The check of the names a card shows against the card itself: the item of Wikidata a name
//               is linked to is kept when the titles of the card fit it, left out when the card means
//               another thing ("Primera División" of a Spanish referee was the Maltese league)
//

"use strict"

import {describeItems} from './wikidata.js';
import {countriesOfItems} from './countries.js';
import {ollamaJson} from './ollama.js';
import {mapWithConcurrency} from './concurrency.js';
import {countryOfSite} from './country-names.js';

// A name is linked once for all its news, by its text: its context is not the card's. Of 242 names shown on
// 207 cards, judged by hand (bench/card-check, 21.10.2026), 14 were wrong (Primera División the Maltese league,
// the FMF of a Malagasy card the Moldovan federation, Feyenoord a defunct baseball team, "CAN" a German band).
// The AI reading the titles of the card and the countries of the sites that published them (the names of the
// countries: "MG" told it nothing, the FMF stayed Moldova's) said "no" to the 14 and to 6 of the 218 right
// ones (UEFA, the continent, the VAR, the AFCON on cards naming them in passing, Ziko spelled Zico; a name left
// out costs a chip, a wrong one a wrong country). Asked for every name it takes 245 tokens each. The wrong
// ones were all in 58 Wikipedias or fewer, 4 of the 6 right ones left out in more: asked only for items in
// CHECK_MAX_LINKS or fewer (39% of the names), the 14 wrong ones are sent and caught, 2 right ones left out
// (about 1 500 tokens a briefing). The cheap signals of the type, the country of the item, the closeness of
// its text to the titles sent more names for fewer caught
export const CHECK_MAX_LINKS = 60;
const CHECK_CONCURRENCY = 4;
const TITLES = 6;

// the countries of the sites publishing the news of a card, "MG (2)" for two of a .mg: a federation called FMF
// is Madagascar's on a card of 2424.mg, Moldova's on one of a Moldovan site
const regions = new Intl.DisplayNames(['en'], {type: 'region'});
export const countryName = (code) => {
    try { return regions.of(code) ?? code; } catch { return code; }
};
export const countriesOfSites = (sites = []) => {
    const count = {};
    for (const site of sites) {
        const code = countryOfSite(site);
        if (code) count[code] = (count[code] ?? 0) + 1;
    }
    return Object.entries(count).sort((a, b) => b[1] - a[1]).map(([code, news]) => `${countryName(code)} (${news})`).join(', ');
};

// what else the card says helps tell a name: its topic and the other names on it ("Napoli" on a card of sport and
// Serie A is the club, not the city; "Primera División" with Spanish referees the Spanish league)
const context = ({topic, others = []}) => `${topic ? `The card is about: ${topic}.\n` : ''}${others.length > 0 ? `Other names on the card: ${others.join(', ')}.\n` : ''}`;

export const checkPrompt = ({name, kind, titles, countries = '', topic = null, others = [], label, description, links, country}) => `A name in the news of one card: "${name}" (${kind}).

Titles of the news of the card:
${titles.map(title => `- ${title}`).join('\n')}
${countries ? `Countries of the sites that published them: ${countries}\n` : ''}${context({topic, others})}
Its link to Wikidata: ${label}: ${description || '(no description)'} (${links} Wikipedias${country ? `, country ${countryName(country)}` : ''}).

Is the "${name}" of this card this item? "yes" when the titles fit what the item says (their field, their role,
their country). "no" when the card means another thing (another person, a place, a work, a body of another
country, a common word). "unsure" when the titles say too little to tell. Use what the card is about and the
other names on it: a name on a sports card is the club, not the city of the same name.
Answer in JSON only: {"same": "yes"}`;

// the items described, kept while the server runs: UEFA and FIFA are named by every other card
const described = new Map();

const describe = async (qids) => {
    const missing = [...new Set(qids)].filter(qid => !described.has(qid));
    for (let i = 0; i < missing.length; i += 10) {
        for (const item of await describeItems(missing.slice(i, i + 10))) described.set(item.qid, item);
    }
};

// read: [{storyId, names, places}] (see card-names.js readNames), cards: [{storyId, titles, sites, topic}] (the
// domains of the sites of its news, what it is about); the same cards
// with the qid of a name the AI says is another thing left out (names: qid null, places: left out). Whatever
// fails (Wikidata, the AI) leaves the name as it was
export const withNamesChecked = async (read, cards, {usage = null} = {}) => {
    const titlesOf = new Map(cards.map(card => [card.storyId, (card.titles ?? []).slice(0, TITLES)]));
    const countriesOf = new Map(cards.map(card => [card.storyId, countriesOfSites(card.sites)]));
    const topicOf = new Map(cards.map(card => [card.storyId, card.topic ?? null]));
    const rows = read.flatMap(card => [...card.names.map(row => ({card, row, list: 'names'})), ...(card.places ?? []).map(row => ({card, row, list: 'places'}))])
        .filter(({card, row}) => row.qid && (titlesOf.get(card.storyId) ?? []).length > 0);
    if (rows.length === 0) return read;
    try {
        await describe(rows.map(({row}) => row.qid));
    } catch (err) {
        console.error(`Names: the items of the cards were not described, none checked (${err.message})`);
        return read;
    }
    const asked = rows.filter(({row}) => {
        const item = described.get(row.qid);
        return item && item.links <= CHECK_MAX_LINKS;
    });
    if (asked.length === 0) return read;
    const countries = await countriesOfItems(asked.map(({row}) => row.qid)).catch(() => new Map());
    const answers = await mapWithConcurrency(asked, CHECK_CONCURRENCY, async ({card, row}) => {
        const item = described.get(row.qid);
        const answer = await ollamaJson(checkPrompt({name: row.name, kind: row.kind ?? 'organization', titles: titlesOf.get(card.storyId),
            countries: countriesOf.get(card.storyId), topic: topicOf.get(card.storyId),
            others: card.names.filter(other => other !== row && other.name !== row.name).map(other => other.name), ...item, country: countries.get(row.qid)?.country ?? null}), usage);
        return answer?.same === 'no';
    });
    let dropped = 0;
    asked.forEach(({row, list, card}, i) => {
        if (answers[i].status !== 'fulfilled' || !answers[i].value) return;
        dropped++;
        if (list === 'names') row.qid = null;
        else card.places = card.places.filter(place => place !== row);
    });
    console.log(`Briefing: ${asked.length} names of ${rows.length} checked on their card, ${dropped} left without their link`);
    return read;
};
