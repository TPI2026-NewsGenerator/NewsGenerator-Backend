//
//  Author: Fabian Rostello
//  Date: 13.10.2026
//  File: card-names.js
//  Description: The people and organisations a card shows, the ones most of its articles name (found by
//               the tagger, see tagging-service.js), each opening its page; and the ones a reader meets
//               card after card without following them, suggested on the page of what they follow
//

"use strict"

import {MentionModel} from '../../models/mention-model.js';
import {mentionKey} from './mentions.js';
import {cardCountries, countriesOfItems} from './countries.js';
import {countryNamed} from './country-names.js';
import {withNamesChecked} from './name-check.js';

export const NAMES_PER_CARD = 4;
// a family name alone tells the country of the person it is linked to when that person is named in full
// by this many news at least: "Trump" is Donald Trump (3 106 news); "Kristal" was not Patrik Kristal, an
// Estonian footballer named by 16 (18.10.2026)
const SURNAME_COUNTRY_SEEN = 100;
// a name of a few of its articles is one named in passing: a quarter of them at least
const SHARE_OF_CARD = 0.25;
// the agencies a dispatch credits ("(Reuters) -", "AFP") are named by every news they wrote, as the
// medium itself is by its own news
const AGENCIES = new Set(['afp', 'ap', 'associated press', 'reuters', 'dpa', 'efe', 'ansa', 'ats', 'keystone-ats', 'sda',
    'apa', 'anp', 'belga', 'pa', 'tass', 'xinhua', 'bloomberg', 'agence france-presse', 'europa press']);
// words the tagger takes for a name that name nothing to follow
const NOT_NAMES = new Set(['tv', 'ia', 'ai', 'llm', 'ceo', 'gp']);
// a name met in fewer news is often a slip of the tagger ("Un entraîneur légendaire"), as for Wikidata
// (see LINK_LEAST in tagging-service.js), unless two articles of the card name it (a referee named for
// a match: "Cihan Aydın")
const LEAST_NEWS = 3;
const SUGGESTED = 8;
const SUGGESTED_FROM_CARDS = 2;

// the small words of a name its initials skip ("Tribunal arbitral du sport" is the TAS)
const LINKING = new Set(['de', 'du', 'des', 'd', 'of', 'the', 'la', 'le', 'les', 'l', 'del', 'della', 'di', 'da', 'do', 'dos', 'das',
    'der', 'von', 'van', 'y', 'e', 'i', 'and', 'et', 'und']);
// an article before a word in small letters makes a description, not a name ("Un entraîneur
// légendaire", "Les agents de codage"); before a capital, it is part of it ("La Liga", "Le PSG")
const ARTICLES = new Set(['un', 'une', 'les', 'le', 'la', 'l', 'the', 'a', 'an', 'one', 'des', 'el', 'los', 'las', 'il', 'lo',
    'gli', 'der', 'die', 'das', 'ein', 'eine', 'o', 'os', 'as', 'um', 'uma']);
const capital = (word) => /^[\p{Lu}\p{N}]/u.test(word);

// Written as a name: it starts with a capital, and so does its last word, its article aside ("FIFA",
// "Tribunal Arbitral", "La Liga"); the tagger also gives descriptions ("promising officials", "Italian
// federation", "fédération portugaise"), their names or acronyms are on the card anyway
export const writtenAsName = (name) => {
    const words = String(name).trim().split(/\s+/).filter(Boolean);
    if (words.length === 0 || !capital(words[0])) return false;
    if (words.length > 1 && ARTICLES.has(words[0].toLowerCase()) && !capital(words[1])) return false;
    return words.length === 1 || capital(words.at(-1));
};

const initials = (key) => key.split(/[\s-]+/).filter(word => word && !LINKING.has(word)).map(word => word[0]).join('');
// The name an item is shown by: its acronym when its label is long and one of its names is it, the one of
// its initials first ("Union of European Football Associations" is the UEFA), else its label
const ACRONYM = /^[\p{Lu}][\p{Lu}\p{N}&]{1,6}$/u;
const LONG_LABEL = 20;
export const shortName = (label, names = []) => {
    if (String(label).length <= LONG_LABEL) return label;
    const acronyms = names.filter(name => ACRONYM.test(name));
    return acronyms.find(name => initials(mentionKey(label)) === mentionKey(name)) ?? acronyms[0] ?? label;
};

// a key without its article: "la caf" is the "caf"
const bare = (key) => {
    const words = key.split(' ');
    return words.length > 1 && ARTICLES.has(words[0]) ? words.slice(1).join(' ') : key;
};
// One name written two ways (longer, shorter: keys, see mentionKey): "latvian fa" holds "fa", "gianni
// infantino" starts as "gianni infant" (a text cut by the tagger, inside a word), "psg" are the initials
// of "paris saint-germain", "man city" a shorter "manchester city", "giannijem infantinom" the same
// declined. "fifa-prasidentschaftswahl" is another thing than the "fifa": a word joined to it
const sameName = (longer, shorter) => {
    const [a, b] = [bare(longer), bare(shorter)];
    if (a === b || ` ${a} `.includes(` ${b} `)) return true;
    if (b.includes(' ') && a.startsWith(b) && /\p{L}/u.test(a[b.length] ?? '')) return true;
    if (!b.includes(' ') && b.length >= 2 && initials(a) === b) return true;
    const [wordsA, wordsB] = [a.split(' '), b.split(' ')];
    return wordsA.length === wordsB.length && wordsA.length > 1 && wordsB.every((word, i) => wordsA[i].startsWith(word));
};

// The writings of one name as one: [{...the one shown, ids}], ids the union of theirs. items: [{name, qid,
// ids}]; weight(item): how much it is met. A writing joins another that holds it or it holds
// ("Infantino" and "Gianni Infantino", "PSG" and "Paris Saint-Germain"), as does one of the same item
// of Wikidata. The one shown is the writing of an item, else the most met: the longest was a compound
// ("FIFA-Präsidentschaftswahl" for the FIFA) or a declined form ("Giannijem Infantinom")
const asOne = (items, weight) => {
    const groups = [];
    const ordered = [...items].map(item => ({...item, key: mentionKey(item.name)}))
        .sort((a, b) => Boolean(b.qid) - Boolean(a.qid) || weight(b) - weight(a) || b.key.length - a.key.length);
    for (const item of ordered) {
        const group = groups.find(other => (item.qid && other.qid === item.qid)
            || ((!item.qid || !other.qid) && (sameName(other.key, item.key) || sameName(item.key, other.key))));
        if (!group) groups.push({...item, ids: new Set(item.ids)});
        else item.ids.forEach(id => group.ids.add(id));
    }
    return groups;
};

// [{name, qid, kind}] of a card: rows, the names of its articles (MentionModel.namesOfArticles, news
// counted up to LEAST_NEWS); articles, how many it has; media, the sites it is of ("lequipe.fr"). The
// ones the most of its articles name first, a name once (its item of Wikidata, its other writings: the
// count of the one most named), places left out: they are where it happened, not who
export const cardNames = (rows, articles, options = {}) => chosenNames(rows, articles, options)
    .map(group => ({name: group.name, qid: group.qid ?? null, kind: group.kind}));

// the rows chosen for a card, with their id (see cardNames)
const chosenNames = (rows, articles, {media = [], max = NAMES_PER_CARD} = {}) => {
    const least = Math.max(1, Math.ceil(articles * SHARE_OF_CARD));
    // "Le Temps" of letemps.ch
    const own = new Set(media.map(site => mentionKey(String(site).split('.')[0]).replace(/[\s-]+/g, '')));
    const candidates = rows
        .filter(row => row.kind !== 'location' && (row.qid || row.news >= LEAST_NEWS || row.inCard >= 2) && writtenAsName(row.name))
        .filter(row => {
            const key = mentionKey(row.name);
            return key.length >= 2 && !AGENCIES.has(key) && !NOT_NAMES.has(key) && !own.has(key.replace(/[\s-]+/g, ''));
        })
        // the articles of a row are not known, only how many: its count stands for them
        .map(row => ({...row, ids: [row.inCard]}));
    return asOne(candidates, row => row.inCard * 1000 + Math.min(row.news ?? 0, 999))
        .map(group => ({...group, inCard: Math.max(...group.ids)}))
        .filter(group => group.inCard >= least)
        .sort((a, b) => b.inCard - a.inCard || b.key.length - a.key.length)
        .slice(0, max);
};

// A family name alone ("Infantino") is no item of Wikidata (a family name, a village, a page of
// namesakes): it is the person linked whose name ends with it ("Gianni Infantino"), when that one is met
// SURNAME_AHEAD times more than any other so named; a person whatever the tagger took it for on this card
// when it takes that word for a person most of the time ("Infantino": a person 1 194 times, an
// organisation 329, a place 124, 18.10.2026), never a club ("Milan") named like someone
const SURNAME_AHEAD = 3;
const MIN_SURNAME = 4;
const surnameKey = (name) => {
    const key = bare(mentionKey(name.name));
    return !name.qid && !key.includes(' ') && key.length >= MIN_SURNAME && ['person', 'organization'].includes(name.kind) ? key : null;
};
// names: the names of each card (see chosenNames); rows: [{word, qid, seen, asPerson, asOther}] (see
// MentionModel.personsEndingWith), the most met first for each word. The names as the card writes them,
// with the person's item and kind (the writing most met was "President Trump", "C. Ronaldo"), and
// bySurname the news naming that person in full; a card naming that person already keeps it once
export const withSurnamesLinked = (names, rows) => {
    const byWord = new Map();
    for (const row of rows) byWord.set(row.word, [...(byWord.get(row.word) ?? []), row]);
    const personOf = (name) => {
        const [first, second] = byWord.get(surnameKey(name)) ?? [];
        if (!first || first.seen < SURNAME_AHEAD * (second?.seen ?? 0)) return null;
        return name.kind === 'person' || first.asPerson > first.asOther ? first : null;
    };
    return names.map(card => {
        const shown = new Set(card.filter(name => name.qid).map(name => name.qid));
        return card.flatMap(name => {
            const person = surnameKey(name) ? personOf(name) : null;
            if (!person) return [name];
            if (shown.has(person.qid)) return [];
            shown.add(person.qid);
            return [{...name, qid: person.qid, kind: 'person', bySurname: person.seen}];
        });
    });
};

// {storyId -> [{name, qid, kind}]} of these cards: [{storyId, ids (of its articles), media}]. The names
// shown that Wikidata was never asked for are asked for first (see MentionModel.want): one that is an
// item opens its page, with its links, instead of the page of the name. A family name alone is the
// person it is the name of (see withSurnamesLinked)
export const namesOfCards = async (cards) => new Map((await readNames(cards))
    .map(card => [card.storyId, card.names.map(group => ({name: group.name, qid: group.qid ?? null, kind: group.kind}))]));

// [{storyId, names, places, toLink, countries}] of these cards (see namesOfCards): names the groups chosen,
// with the news of the card naming them (inCard); places the rows of the places of Wikidata a quarter of
// its news name, toLink the ids of the ones never looked for; countries [{code, inCard}] the countries it
// names, by their names: Wikidata could not tell them apart from their namesakes ("Espagne", "France": 1
// country named of 15 linked, 18.10.2026), or had them as another item ("China" the cultural region), so
// their items are left out
const readNames = async (cards) => {
    const read = await Promise.all(cards.map(async (card) => {
        const rows = await MentionModel.namesOfArticles(card.ids, LEAST_NEWS);
        const least = Math.max(1, Math.ceil(card.ids.length * SHARE_OF_CARD));
        const places = rows.filter(row => row.kind === 'location' && row.inCard >= least && !countryNamed(row.name));
        return {storyId: card.storyId, names: chosenNames(rows, card.ids.length, {media: card.media}),
            places: places.filter(row => row.qid),
            // the places never looked for in Wikidata, asked for first: "Carei", the town of a referee
            // named by 4 news, waited behind the most met names and its card had no country (19.10.2026)
            toLink: places.filter(row => !row.qid && !row.linkedAt && writtenAsName(row.name)).map(row => row.id),
            countries: rows.filter(row => row.kind !== 'person' && row.inCard >= least)
                .map(row => ({code: countryNamed(row.name), inCard: row.inCard})).filter(row => row.code)};
    }));
    const words = [...new Set(read.flatMap(card => card.names.map(surnameKey).filter(Boolean)))];
    const persons = await MentionModel.personsEndingWith(words).catch(err => {
        console.error(`Names: the family names were not read (${err.message})`);
        return [];
    });
    const linked = withSurnamesLinked(read.map(card => card.names), persons);
    const ids = [...linked.flatMap(names => names.filter(name => !name.qid && name.id).map(name => name.id)),
        ...read.flatMap(card => card.toLink)];
    if (ids.length > 0) await MentionModel.want({ids}).catch(err => console.error(`Names: not asked first in Wikidata (${err.message})`));
    return read.map((card, i) => ({...card, names: linked[i]}));
};

// {storyId -> {names, countries}} of these cards [{storyId, ids, media, titles}] (see namesOfCards): countries the codes ISO 3166-1 of
// the countries of who and where it names, the main first (see countries.js), none when Wikidata does not
// tell them
export const namesAndCountriesOfCards = async (cards, {usage = null} = {}) => {
    // a name is linked by its text for all its news: the card tells whether the item is the one it means
    const read = await withNamesChecked(await readNames(cards), cards, {usage});
    const items = read.map(card => [...card.names, ...card.places]
        .filter(row => row.qid && !(row.bySurname < SURNAME_COUNTRY_SEEN) && !countryNamed(row.name))
        .map(row => ({qid: row.qid, weight: row.inCard, person: row.kind === 'person'})));
    const countryOf = await countriesOfItems(items.flat().map(item => item.qid)).catch(err => {
        console.error(`Names: the countries of the cards were not read (${err.message})`);
        return new Map();
    });
    // a country named: its own code (see country-names.js countryNamed)
    const named = read.map(card => card.countries.map(row => ({qid: `country:${row.code}`, weight: row.inCard})));
    named.flat().forEach(item => countryOf.set(item.qid, {country: item.qid.slice('country:'.length), international: false}));
    return new Map(read.map((card, i) => [card.storyId, {
        names: card.names.map(group => ({name: group.name, qid: group.qid ?? null, kind: group.kind})),
        countries: cardCountries([...items[i], ...named[i]], countryOf),
    }]));
};

// The names met on several cards a reader was shown that they follow neither as an item of Wikidata nor
// as a word: [{name, qid, kind, cards}], the most met first. cards: [[{name, qid, kind}]], the names of
// each card; followed: {qids, words} (words as written)
export const suggestedNames = (cards, {qids = [], words = []} = {}, {least = SUGGESTED_FROM_CARDS, max = SUGGESTED} = {}) => {
    const known = new Set(qids);
    const written = new Set(words.map(mentionKey));
    const met = new Map();
    cards.forEach((names, card) => {
        for (const name of names ?? []) {
            const id = name.qid ?? mentionKey(name.name);
            const entry = met.get(id) ?? {name: name.name, qid: name.qid ?? null, kind: name.kind, ids: new Set()};
            entry.ids.add(card);
            met.set(id, entry);
        }
    });
    // a writing of a name followed is followed ("Infantino" of "Gianni Infantino" followed as a word)
    return asOne([...met.values()], entry => entry.ids.size)
        .filter(group => !(group.qid && known.has(group.qid)) && ![...written].some(word => sameName(group.key, word) || sameName(word, group.key)))
        .map(group => ({name: group.name, qid: group.qid ?? null, kind: group.kind, cards: group.ids.size}))
        .filter(entry => entry.cards >= least)
        .sort((a, b) => b.cards - a.cards || a.name.localeCompare(b.name))
        .slice(0, max);
};
