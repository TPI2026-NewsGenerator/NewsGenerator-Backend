//
//  Author: Fabian Rostello
//  Date: 21.10.2026
//  File: name-check.js
//  Description: The names a card shows against the card itself: the item of Wikidata a name is linked to is
//               kept when the titles of the card fit it, left out when the card means another thing
//               ("Primera División" of a Spanish referee was the Maltese league); a name with no item,
//               or one the check sent away, chooses among its candidates with what the card says
//

"use strict"

import {describeItems, exactItems} from './wikidata.js';
import {searchedItems} from './wikipedia-search.js';
import {countriesOfItems} from './countries.js';
import {ollamaJson} from './ollama.js';
import {mapWithConcurrency} from './concurrency.js';
import {countryOfSite} from './country-names.js';
import {mentionKey} from './mentions.js';
import {MentionModel} from '../../models/mention-model.js';

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
const countsOfSites = (sites) => {
    const count = {};
    for (const site of sites) {
        const code = countryOfSite(site);
        if (code) count[code] = (count[code] ?? 0) + 1;
    }
    return Object.entries(count).sort((a, b) => b[1] - a[1]);
};
export const countriesOfSites = (sites = []) => countsOfSites(sites).map(([code, news]) => `${countryName(code)} (${news})`).join(', ');
// the name of the country most of these sites are of, null when none has one
export const mainCountryOfSites = (sites = []) => {
    const [first] = countsOfSites(sites);
    return first ? countryName(first[0]) : null;
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

// ": a, b, c" of the first names, for the log: what the AI decided, to be read afterwards
const LOGGED_NAMES = 12;
const listOf = (names) => names.length === 0 ? '' : `: ${names.slice(0, LOGGED_NAMES).join('; ')}${names.length > LOGGED_NAMES ? `; and ${names.length - LOGGED_NAMES} more` : ''}`;

const describe = async (qids) => {
    const missing = [...new Set(qids)].filter(qid => !described.has(qid));
    for (let i = 0; i < missing.length; i += 50) {
        for (const item of await describeItems(missing.slice(i, i + 50), {batch: 50})) described.set(item.qid, item);
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
    const droppedNames = [];
    asked.forEach(({row, list, card}, i) => {
        if (answers[i].status !== 'fulfilled' || !answers[i].value) return;
        dropped++;
        droppedNames.push(`${row.name} (${described.get(row.qid)?.label ?? row.qid})`);
        if (list === 'names') {
            // the item refused is no candidate for the name on this card (see withNamesLinked)
            row.refused = row.qid;
            row.qid = null;
        } else card.places = card.places.filter(place => place !== row);
    });
    console.log(`Briefing: ${asked.length} names of ${rows.length} checked on their card, ${dropped} left without their link${listOf(droppedNames)}`);
    return read;
};

// A name the link loop left with no item, whatever it was told in its news (a namesake, an acronym, a city and a
// club of one name): the card chooses among the items the loop found for it (the qids kept by
// MentionModel.setCandidates) with what it says: its titles, its topic, the other names on it and the countries
// of its sites. Measured on the blind bench (bench/blind, 22.10.2026: 240 names drawn at random from 210 cards,
// judged before any system ran) on the 133 names the cards showed with no link: 64 right, 4 wrong (all
// persons: namesakes, 3 of them in under 2 Wikipedias: a person is taken in 2 Wikipedias at least, PERSON_LEAST),
// 65 left alone; the organisations 47 right of 47. About 390 tokens a name. A sentence asking for no namesake did
// no better (223 right of 240 against 224), the countries given by their names, the cards' own wording kept
const MAX_CARD_LINKS = 60;
const CARD_CANDIDATES = 10;
export const PERSON_LEAST = 2;

// A name the check sent away ("no") is left with no link, so no country: the FMF of a Malagasy card showed Moldova,
// then nothing. Its exact search in Wikidata does not help (the 14 wrong links of bench/card-check, 16 cases with
// the 2 of the right country only: 0 right; "FMF" found a disease, a gene and the Mexican federation, not the
// Malagasy one), so the candidates come from the card (bench/relink-after-no, 22 cases with the 6 right links the
// check sends away too): A what its text says the name stands for ("Fédération malgache de football (FMF)", that
// name searched in Wikidata), B the Wikipedia search of the name with the country most of its sites are of ("FMF
// Madagascar"). The AI chooses among them as among the candidates kept for a name: the FMF Malagasy, Fiorentina for
// "La Fiorentina", Feyenoord Rotterdam, the Greek Super League; 5 right of 12, none wrong, none restored from the 6
// right links (the refused item left out: kept as a candidate it restored 1 and gave 1 wrong, "Lega Pro" for the
// Italian league). Only the names the check sent away, MAX_RELINK a briefing: a search and a call each
const MAX_RELINK = 10;
const SMALL_WORDS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'of', 'the', 'y', 'e', 'da', 'do', 'di', 'del', 'della', 'and', 'et', 'und', 'van', 'von', 'el', 'al', 'd', 'l', 'a', 'o', 'dos', 'das']);
const spelling = (words) => words.filter(word => !SMALL_WORDS.has(word.toLowerCase().replace(/['’]$/, ''))).map(word => word[0]).join('');

// "Fédération malgache de football" of "(FMF)" in this text: the words before the name between parentheses
// whose initials spell it (2 to 8 of them), null when it is not defined there
export const expansionOf = (name, text) => {
    const key = mentionKey(name).replace(/[^a-z]/g, '');
    if (key.length < 2 || key.length > 8 || !text) return null;
    const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const match of text.matchAll(new RegExp(`\\(\\s*${escaped}\\s*\\)`, 'g'))) {
        const words = text.slice(Math.max(0, match.index - 120), match.index).trim().split(/\s+/).map(word => word.replace(/^[«"“(]+/, '')).filter(Boolean);
        for (let size = 2; size <= 8 && size <= words.length; size++) {
            const tail = words.slice(-size);
            if (mentionKey(spelling(tail)).replace(/[^a-z]/g, '') === key) return tail.join(' ');
        }
    }
    return null;
};

// [qid] of the items this card points to for this name, except the one the check refused; whatever fails
// (Wikidata asking to wait, Wikipedia) leaves the others
const candidatesAfterNo = async (row, card) => {
    const found = [];
    const expansion = expansionOf(row.name, card?.text ?? '');
    if (expansion) found.push(...await exactItems(expansion, card.language ?? 'en').catch(() => []));
    const country = mainCountryOfSites(card?.sites);
    if (country) found.push(...await searchedItems(`${row.name} ${country}`));
    return [...new Set(found)].filter(qid => qid !== row.refused).slice(0, CARD_CANDIDATES);
};

export const linkPrompt = ({name, kind, titles, countries = '', topic = null, others = [], candidates}) => `A name in the news: "${name}" (${kind}).

Titles of news naming it:
${titles.map(title => `- ${title}`).join('\n')}

The card these news make is about: ${topic ?? 'unknown'}.
Other names on the card: ${others.join(', ') || 'none'}.
Countries of the sites that published the news: ${countries || 'unknown'}.

Items of Wikidata called so or near:
${candidates.map((item, i) => `[${i + 1}] ${item.label}: ${item.description || '(no description)'} (${item.links} Wikipedias)`).join('\n')}

Which item is the "${name}" these news name? Use what the card is about and the other names: a name on a sports card is the club, not the city of the same name. Only when you are sure from the titles: a person, a club, a league, a body these news are about. 0 when none of them is, when you cannot tell, or when the name is only a part of many names ("FC", "Club", "United").
Answer in JSON only: {"n": 0}`;

// read: [{storyId, names}], cards: [{storyId, titles, sites, topic, text, language}] (text: what the card says, for
// the names it spells out): the same cards, the persons in full and the organisations shown with no qid that have
// candidates given the one the AI chooses (a person in PERSON_LEAST Wikipedias at least). The candidates are the ones
// kept for the name (see MentionModel.setCandidates) and, for a name the check sent away on this card, the ones the
// card points to (candidatesAfterNo). A word alone is left to its card (see card-names.js withSurnamesLinked).
// Whatever fails (the database, Wikidata, the AI) leaves the name as it was
export const withNamesLinked = async (read, cards, {usage = null} = {}) => {
    const cardOf = new Map(cards.map(card => [card.storyId, card]));
    const rows = read.flatMap(card => card.names
        .filter(row => !row.qid && row.id && (row.kind === 'organization' || (row.kind === 'person' && mentionKey(row.name).includes(' '))))
        .map(row => ({card, row})))
        .filter(({card}) => (cardOf.get(card.storyId)?.titles ?? []).length > 0);
    if (rows.length === 0) return read;
    let stored = new Map();
    try {
        stored = await MentionModel.candidatesOf([...new Set(rows.map(({row}) => row.id))]);
    } catch (err) {
        console.error(`Names: the candidates of the names of the cards were not read (${err.message})`);
    }
    // the candidates of a name on a card: the ones kept for the name, without the item the check refused for it
    const candidatesOf = new Map(rows.map(({row}) => [row, (stored.get(row.id) ?? []).filter(qid => qid !== row.refused)]));
    const sentAway = rows.filter(({row}) => row.refused).slice(0, MAX_RELINK);
    for (const {card, row} of sentAway) {
        const fresh = await candidatesAfterNo(row, cardOf.get(card.storyId)).catch(() => []);
        candidatesOf.set(row, [...new Set([...fresh, ...candidatesOf.get(row)])]);
    }
    const asked = rows.filter(({row}) => candidatesOf.get(row).length > 0).slice(0, MAX_CARD_LINKS);
    if (asked.length === 0) return read;
    try {
        await describe(asked.flatMap(({row}) => candidatesOf.get(row).slice(0, CARD_CANDIDATES)));
    } catch (err) {
        console.error(`Names: the candidates of the cards were not described, none chosen (${err.message})`);
        return read;
    }
    const answers = await mapWithConcurrency(asked, CHECK_CONCURRENCY, async ({card, row}) => {
        const candidates = candidatesOf.get(row).slice(0, CARD_CANDIDATES).map(qid => described.get(qid)).filter(Boolean);
        if (candidates.length === 0) return null;
        const meta = cardOf.get(card.storyId);
        const answer = await ollamaJson(linkPrompt({name: row.name, kind: row.kind, titles: (meta.titles ?? []).slice(0, TITLES),
            countries: countriesOfSites(meta.sites), topic: meta.topic ?? null,
            others: card.names.filter(other => other !== row).map(other => other.name), candidates}), usage);
        const chosen = candidates[Number(answer?.n) - 1];
        return chosen && (row.kind !== 'person' || chosen.links >= PERSON_LEAST) ? chosen.qid : null;
    });
    let linked = 0;
    const linkedNames = [];
    asked.forEach(({row}, i) => {
        if (answers[i].status !== 'fulfilled' || !answers[i].value) return;
        row.qid = answers[i].value;
        linkedNames.push(`${row.name} -> ${described.get(row.qid)?.label ?? row.qid}${row.refused ? ` (not ${described.get(row.refused)?.label ?? row.refused})` : ''}`);
        linked++;
    });
    console.log(`Briefing: ${asked.length} names with no item chosen among their candidates on their card (${sentAway.length} sent away by the check, searched again), ${linked} linked${listOf(linkedNames)}`);
    return read;
};
