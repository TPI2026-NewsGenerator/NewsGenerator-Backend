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
import {mentionKey, PLACES_RULES_FROM, withoutParticle} from './mentions.js';
import {collapsed, romanizations, sameGivenName} from './romanize.js';
import {labelsOfItems} from './card-spellings.js';
import {alignNames} from './spellings.js';
import {nameKeysOf} from './wikidata.js';
import {nationalityOf} from './nationalities.js';
import {cardCountries, countriesOfItems} from './countries.js';
import {chooseCountries, countryCandidates} from './country-choice.js';
import {countryDeclined, countryName, countryNamed} from './country-names.js';
import {withNamesChecked, withNamesLinked} from './name-check.js';

export const NAMES_PER_CARD = 4;
// a family name alone tells the country of the person it is linked to when that person is named in full
// by this many news at least: "Trump" is Donald Trump (3 106 news); "Kristal" was not Patrik Kristal, an
// Estonian footballer named by 16 (18.10.2026)
const SURNAME_COUNTRY_SEEN = 100;
// a name of a few of its articles is one named in passing: a quarter of them at least
const SHARE_OF_CARD = 0.25;
// a person the title of the card says is a name of it with a tenth of its articles, two at least: the card of "El mensaje de Emilio García
// Silvero" had joined four stories (113 articles), 25 of them named him, and his chip was gone (the unsaved briefing of Enzo, 8.11.2026)
const SHARE_OF_CARD_TITLED = 0.1;
const LEAST_TITLED = 2;
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
// strict: only the acronym that is the initials of the label counts, not the first acronym met (the names of an
// item of Wikidata are in many languages: "FGF" is the Guinean federation in French, not for a reader of English)
export const shortName = (label, names = [], {strict = false} = {}) => {
    if (String(label).length <= LONG_LABEL) return label;
    const acronyms = names.filter(name => ACRONYM.test(name));
    return acronyms.find(name => initials(mentionKey(label)) === mentionKey(name)) ?? (strict ? undefined : acronyms[0]) ?? label;
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
export const sameName = (longer, shorter) => {
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
        if (!group) groups.push({...item, ids: new Set(item.ids), keys: new Set([item.key])});
        else {
            item.ids.forEach(id => group.ids.add(id));
            group.keys.add(item.key);
        }
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
const chosenNames = (rows, articles, {media = [], max = NAMES_PER_CARD, title = ''} = {}) => {
    const least = Math.max(1, Math.ceil(articles * SHARE_OF_CARD));
    const leastTitled = Math.max(LEAST_TITLED, Math.ceil(articles * SHARE_OF_CARD_TITLED));
    const words = (key) => key.replace(/[^\p{L}\p{N}']+/gu, ' ').trim();
    const titleKey = ` ${words(mentionKey(title))} `;
    // a person the title says: by the name shown, a writing of it of two words at least, or its family name alone ("Infantino"); a person
    // linked or named in full only: the tagger takes a word of a title for one ("Effigy", "bonfire effigy": measured on the 593 cards of the
    // last 40 briefings, 6 cards gained a name, 4 right, the 2 wrong ones a word alone with no item)
    const inTitle = (group) => group.kind === 'person' && (group.qid || group.key.includes(' ')) && [...group.keys].map(words).some(key => key.length >= 4 && titleKey.includes(` ${key} `)
        && (key === words(group.key) || key.includes(' ') || words(group.key).endsWith(` ${key}`)));
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
    // the articles that name an item are counted once each whatever the writings they name it with (the rows' itemInCard, see
    // MentionModel.namesOfArticles): the writing most met alone left the Argentine federation of 82 articles out of the card
    return asOne(candidates, row => row.inCard * 1000 + Math.min(row.news ?? 0, 999))
        .map(group => ({...group, inCard: Math.max(...group.ids, group.itemInCard ?? 0)}))
        .filter(group => group.inCard >= least || (group.inCard >= leastTitled && inTitle(group)))
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
    // a name in Greek or Cyrillic letters is looked for by its Latin spellings (see romanKeys), not by its own letters
    return !name.qid && !key.includes(' ') && key.length >= MIN_SURNAME && ['person', 'organization'].includes(name.kind) && romanizations(name.name).length === 0 ? key : null;
};
// A person written in Greek or Cyrillic letters that Wikidata has not as the press writes it ("Τζιάνι Ινφαντίνο", Wikidata has "Τζάνι
// Ινφαντίνο": the briefing 444 of 6.11.2026 had no person, no country for it) is the person linked whose family name has the Latin
// spellings of its own, doubled letters aside, by the same rule as a family name alone: met SURNAME_AHEAD times more than any other so
// named. A name in full tells its given name too, which must be one of the person's, as written with other letters ("Thomas" is
// not "Gerd"). Only a person: the tagger takes a name for anything on a card
export const romanKeys = (name) => (!name.qid && name.kind === 'person' ? romanizations(name.name).map(mentionKey).filter(Boolean) : []);
const MIN_SEEN_ROMAN = 3;
// names: the names of each card (see chosenNames); rows: [{word, qid, seen, asPerson, asOther}] (see
// MentionModel.personsEndingWith), the most met first for each word; loose: [{word, qid, seen, keys}] (see
// MentionModel.personsByLooseSurname) for the names in other letters. The names as the card writes them,
// with the person's item and kind (the writing most met was "President Trump", "C. Ronaldo"), and
// bySurname the news naming that person in full; a card naming that person already keeps it once
export const withSurnamesLinked = (names, rows, loose = []) => {
    const byWord = new Map();
    for (const row of rows) byWord.set(row.word, [...(byWord.get(row.word) ?? []), row]);
    const byLoose = new Map();
    for (const row of loose) byLoose.set(row.word, [...(byLoose.get(row.word) ?? []), row]);
    const personOf = (name) => {
        const [first, second] = byWord.get(surnameKey(name)) ?? [];
        if (!first || first.seen < SURNAME_AHEAD * (second?.seen ?? 0)) return null;
        return name.kind === 'person' || first.asPerson > first.asOther ? first : null;
    };
    const romanPersonOf = (name) => {
        const found = new Map();
        for (const key of romanKeys(name)) {
            const words = key.split(' ');
            for (const row of byLoose.get(collapsed(words.at(-1))) ?? []) {
                const given = words.length > 1 ? words[0] : null;
                if (given && !row.keys.some(writing => sameGivenName(given, writing.split(' ')[0]))) continue;
                found.set(row.qid, row);
            }
        }
        const [first, second] = [...found.values()].sort((a, b) => b.seen - a.seen);
        return first && first.seen >= MIN_SEEN_ROMAN && first.seen >= SURNAME_AHEAD * (second?.seen ?? 0) ? first : null;
    };
    return names.map(card => {
        const shown = new Set(card.filter(name => name.qid).map(name => name.qid));
        return card.flatMap(name => {
            const person = surnameKey(name) ? personOf(name) : romanPersonOf(name);
            if (!person) return [name];
            if (shown.has(person.qid)) return [];
            shown.add(person.qid);
            return [{...name, qid: person.qid, kind: 'person', bySurname: person.seen}];
        });
    });
};

// The names of a card once tidied (the unsaved briefing of Enzo of 8.11.2026 showed "KFA는", "FIFA-e", "Arsenala" and "Ceferin" under a
// text that said "Čeferin"): a particle of Korean or Japanese glued to a name is taken off ("KFA는" is the "KFA", see
// withoutParticle), a declined form of an organisation linked is that organisation, and a name linked is spelled as Wikidata spells it
// when the letters are the same (accents aside), as the translation of the card is
//
// A name that two writings of it make twice is one, the one linked first: the position of the first kept
const once = (names) => {
    const kept = [];
    for (const name of names) {
        const key = mentionKey(name.name);
        const at = kept.findIndex(other => name.qid && other.qid === name.qid || (!name.qid || !other.qid) && mentionKey(other.name) === key);
        if (at < 0) kept.push(name);
        else if (name.qid && !kept[at].qid) kept[at] = name;
    }
    return kept;
};
const unglued = (name) => {
    const bare = withoutParticle(name.name);
    return bare === name.name ? name : {...name, name: bare, ...('key' in name ? {key: mentionKey(bare)} : {})};
};
export const withParticlesOff = (names) => once(names.map(unglued));

// The endings a name takes in the languages with cases (Czech, Croatian, Albanian, Hungarian, German...): "Arsenala", "Juventusu",
// "Bayerns". An organisation unlinked that is one of them added to a name linked, a hundred times more met than it is, is that name.
// A one-letter "s" only after a name of six letters at least ("Marcas" is no "Marca"), and no other ending that makes another
// word ("Sportal" is no "Sport"). Measured on the 120 forms of the base met the most, 8.11.2026: 7 in 100 were another word
// (Udinese, Indians, Americans, staten...), most of them with an ending left out here
const ENDINGS = ['a', 'e', 'i', 'u', 'y', 'om', 'em', 'it', 'in', 'ën', 'ës', 'ja', 'ju', 'ov', 's'];
const MIN_STEM = 4;
const MIN_STEM_FOR_S = 6;
const MIN_STEM_SEEN = 100;
const STEM_AHEAD = 5;
// a stem and a suffix of small letters joined by a hyphen ("FIFA-e", "SAD-u"), never two names ("Villarreal-PSG") nor a word ("Sud-est")
const HYPHEN_FORM = /^(\p{Lu}[\p{L}\d]*)-(\p{Ll}{1,3})$/u;
// [[form key, stem key]] the stems an unlinked organisation may be a declined form of: see MentionModel.inflectedForms
export const stemsOf = (name) => {
    if (name.qid || name.kind !== 'organization') return [];
    const key = mentionKey(name.name);
    const hyphen = HYPHEN_FORM.exec(name.name);
    if (hyphen) return [[key, mentionKey(hyphen[1])]];
    if (/[\s-]/.test(key)) return [];
    return ENDINGS.filter(ending => key.endsWith(ending) && key.length - ending.length >= (ending === 's' ? MIN_STEM_FOR_S : MIN_STEM))
        .map(ending => [key, key.slice(0, -ending.length)]);
};
// rows: [{form, stem, name, qid, stemSeen, formSeen}] (see MentionModel.inflectedForms)
export const withInflectionsFolded = (names, rows) => once(names.map(name => {
    const stems = new Set(stemsOf(name).map(([, stem]) => stem));
    const key = mentionKey(name.name);
    const [best] = rows.filter(row => row.form === key && stems.has(row.stem) && row.stemSeen >= MIN_STEM_SEEN && row.stemSeen >= STEM_AHEAD * row.formSeen)
        .sort((a, b) => b.stemSeen - a.stemSeen);
    return best ? {...name, name: best.name, qid: best.qid, ...('key' in name ? {key: mentionKey(best.name)} : {})} : name;
}));
// A name linked as Wikidata spells it. labels: Map qid -> the label of Wikidata in the Latin alphabet (see labelsOfItems). The text of a
// card translated spells its names as Wikidata does (see card-spellings.js): an organisation not written as an acronym, and a person
// in other letters than the Latin ones, are shown by their label then (a card in Dutch said "Union Caribeña de Fútbol" and
// "Confederación Asiática" under a text of "Caribbean Football Union" and "Asian Football Confederation", briefing 469 of 8.11.2026).
// Else the letters of the label with other accents only ("Čeferin" for "Ceferin"), as the translation does
const LATIN_ONLY = /^[\p{Script=Latin}\p{N}\p{M}\s.'’&,-]+$/u;
export const withWikidataSpelling = (names, labels, {translated = false} = {}) => names.map(name => {
    const label = name.qid && labels.get(name.qid);
    if (!label) return name;
    const asLabel = translated && !ACRONYM.test(name.name) && mentionKey(name.name) !== mentionKey(label)
        && (name.kind === 'organization' || !LATIN_ONLY.test(name.name));
    const spelled = asLabel ? label : alignNames(name.name, [label]);
    return spelled === name.name ? name : {...name, name: spelled};
});
// An acronym the tagger could not link ("KFA": the search in English of Wikidata does not find it, the Korea Football Association has it
// as an alias in Korean only) is the organisation linked that the articles of the card name, when that one alone is called so in
// some language. orgs: the items of the organisations the articles of the card name; keys: Map qid -> [key] what each is called (see
// nameKeysOf). An acronym of three letters at least: "FA" is the alias of too many
const ACRONYM_NAME = /^[\p{Lu}][\p{Lu}\p{N}&]{2,6}$/u;
export const isUnlinkedAcronym = (name) => !name.qid && name.kind === 'organization' && ACRONYM_NAME.test(name.name);
export const withAcronymsLinked = (names, orgs, keys) => once(names.map(name => {
    if (!isUnlinkedAcronym(name)) return name;
    const key = mentionKey(name.name);
    const called = [...new Set(orgs)].filter(qid => (keys.get(qid) ?? []).includes(key));
    return called.length === 1 ? {...name, qid: called[0]} : name;
}));
// names: the names of each card; orgs: for each card, the items of the organisations its articles name; translated: for each card,
// whether its text is translated (the labels are asked of Wikidata apart, once the names are linked: see spelledNames)
export const tidyNames = (names, {stems = [], labels = new Map(), orgs = [], nameKeys = new Map(), translated = []} = {}) =>
    names.map((card, i) => withWikidataSpelling(withInflectionsFolded(withAcronymsLinked(withParticlesOff(card), orgs[i] ?? [], nameKeys), stems), labels,
        {translated: Boolean(translated[i])}));
// The names of these cards (read: [{storyId, names}], once linked) spelled as Wikidata does (see withWikidataSpelling); cards:
// [{storyId, language}], the language of the lead of each, reader the one of the reader (codes): a card in another language is
// translated. Wikidata or the database not answering leaves the names as they are
const spelledNames = async (read, cards = [], reader = null) => {
    const qids = [...new Set(read.flatMap(card => card.names.map(name => name.qid)).filter(Boolean))];
    if (qids.length === 0) return read;
    const labels = await labelsOfItems(qids).catch(err => {
        console.error(`Names: the spellings of Wikidata were not read (${err.message})`);
        return new Map();
    });
    const languageOf = new Map(cards.map(card => [card.storyId, card.language ?? null]));
    return read.map(card => ({...card, names: withWikidataSpelling(card.names, labels,
        {translated: Boolean(reader && languageOf.get(card.storyId) && languageOf.get(card.storyId) !== reader)})}));
};

// {storyId -> [{name, qid, kind}]} of these cards: [{storyId, ids (of its articles), media}]. The names
// shown that Wikidata was never asked for are asked for first (see MentionModel.want): one that is an
// item opens its page, with its links, instead of the page of the name. A family name alone is the
// person it is the name of (see withSurnamesLinked)
export const namesOfCards = async (cards, {reader = null} = {}) => new Map((await spelledNames(await readNames(cards), cards, reader))
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
        // a place or a country counts the articles naming its item under any writing, as a name does (see chosenNames)
        const taken = (row) => Math.max(row.inCard, row.itemInCard ?? 0);
        // a place with no item whose name is a country declined ("Hiszpanii", see country-names.js): that country
        const declined = (row) => row.kind === 'location' && !row.qid ? countryDeclined(row.name, row.lang) : null;
        const places = rows.filter(row => row.kind === 'location' && taken(row) >= least && !countryNamed(row.name) && !declined(row));
        return {storyId: card.storyId, names: chosenNames(rows, card.ids.length, {media: card.media, title: card.title}),
            // the organisations its articles name, however few (an acronym of the card may be an alias of one of them)
            orgs: [...new Set(rows.filter(row => row.kind === 'organization' && row.qid).map(row => row.qid))],
            places: places.filter(row => row.qid),
            // the places never looked for in Wikidata, asked for first: "Carei", the town of a referee
            // named by 4 news, waited behind the most met names and its card had no country (19.10.2026)
            // (and the ones looked for before the rules of the places changed: see MentionModel.want)
            toLink: places.filter(row => !row.qid && (!row.linkedAt || new Date(row.linkedAt) < PLACES_RULES_FROM) && writtenAsName(row.name)).map(row => row.id),
            countries: rows.filter(row => row.kind !== 'person' && taken(row) >= least)
                .map(row => ({code: countryNamed(row.name) ?? declined(row), inCard: taken(row)})).filter(row => row.code),
            // the countries the words of the organisations' names say ("Eesti jalgpalliliit", "Fédération Algérienne"), see nationalities.js
            nationalities: rows.filter(row => row.kind === 'organization' && taken(row) >= least)
                .map(row => ({code: nationalityOf(row.name, row.kind), inCard: taken(row)})).filter(row => row.code)};
    }));
    const words = [...new Set(read.flatMap(card => card.names.map(surnameKey).filter(Boolean)))];
    const persons = await MentionModel.personsEndingWith(words).catch(err => {
        console.error(`Names: the family names were not read (${err.message})`);
        return [];
    });
    // the names in Greek or Cyrillic letters: the family names of their Latin spellings, doubled letters as one
    const looseWords = [...new Set(read.flatMap(card => card.names.flatMap(name => romanKeys(name).map(key => collapsed(key.split(' ').at(-1))))).filter(word => word.length >= MIN_SURNAME))];
    const loose = await MentionModel.personsByLooseSurname(looseWords).catch(err => {
        console.error(`Names: the persons of names in other letters were not read (${err.message})`);
        return [];
    });
    const surnamed = withSurnamesLinked(read.map(card => card.names), persons, loose).map(withParticlesOff);
    // the declined forms of the organisations linked (the database not answering leaves the names as they are)
    const forms = [...new Map(surnamed.flatMap(names => names.flatMap(stemsOf)).map(pair => [pair.join(' '), pair])).values()];
    const stems = await MentionModel.inflectedForms(forms).catch(err => {
        console.error(`Names: the declined forms were not read (${err.message})`);
        return [];
    });
    const orgs = read.map(card => card.orgs);
    const acronymOrgs = [...new Set(surnamed.flatMap((names, i) => names.some(isUnlinkedAcronym) ? orgs[i] : []))];
    const nameKeys = acronymOrgs.length === 0 ? new Map() : await nameKeysOf(acronymOrgs).catch(err => {
        console.error(`Names: what the organisations of the cards are called was not read (${err.message})`);
        return new Map();
    });
    const linked = tidyNames(surnamed, {stems, orgs, nameKeys});
    const ids = [...linked.flatMap(names => names.filter(name => !name.qid && name.id).map(name => name.id)),
        ...read.flatMap(card => card.toLink)];
    if (ids.length > 0) await MentionModel.want({ids}).catch(err => console.error(`Names: not asked first in Wikidata (${err.message})`));
    return read.map((card, i) => ({...card, names: linked[i]}));
};

// {storyId -> {names, countries}} of these cards [{storyId, ids, media, titles}] (see namesOfCards): countries the codes ISO 3166-1 of
// the countries of who and where it names, the main first (see countries.js), none when Wikidata does not
// tell them
export const namesAndCountriesOfCards = async (cards, {usage = null, choose = true, reader = null} = {}) => {
    // a name is linked by its text for all its news: the card tells whether the item is the one it means, and
    // which of its candidates when it has none; then the names linked are spelled as Wikidata does (see withWikidataSpelling:
    // reader, the language of the reader, tells which cards are translated)
    const read = await spelledNames(await withNamesLinked(await withNamesChecked(await readNames(cards), cards, {usage}), cards, {usage}), cards, reader);
    const items = read.map(card => [...card.names, ...card.places]
        .filter(row => row.qid && !(row.bySurname < SURNAME_COUNTRY_SEEN) && !countryNamed(row.name))
        .map(row => ({qid: row.qid, weight: row.inCard, person: row.kind === 'person'})));
    const countryOf = await countriesOfItems(items.flat().map(item => item.qid)).catch(err => {
        console.error(`Names: the countries of the cards were not read (${err.message})`);
        return new Map();
    });
    // a country named: its own code (see country-names.js countryNamed)
    const named = read.map(card => card.countries.map(row => ({qid: `country:${row.code}`, weight: row.inCard})));
    // a country the words of the names of its organisations say (see nationalities.js): of a card that nothing else gives a country or a
    // candidate to (all its names international, or without a country: the Estonian federation "Eesti jalgpalliliit" of a card naming
    // UEFA), and only then, the card's other evidence being surer (a federation of another country named in passing: Guinea, on a
    // card of Nigeria)
    const said = read.map(card => card.nationalities.map(row => ({qid: `country:${row.code}`, weight: row.inCard})));
    [...named.flat(), ...said.flat()].forEach(item => countryOf.set(item.qid, {country: item.qid.slice('country:'.length), international: false}));
    const evidence = read.map((card, i) => {
        const strong = [...items[i], ...named[i]];
        return cardCountries(strong, countryOf).length === 0 && countryCandidates(strong, countryOf, new Map()).length === 0 ? [...strong, ...said[i]] : strong;
    });
    // the rules of countries.js decide the countries of a card; the AI then chooses among the candidates Wikidata found
    // (see country-choice.js) and its choice replaces them, a card it does not answer keeping the rules'. choose: false
    // leaves the rules alone (bench/card-countries.mjs compares the two)
    const byStory = new Map(cards.map(card => [card.storyId, card]));
    const rules = evidence.map(list => cardCountries(list, countryOf));
    const asked = read.map((card, i) => {
        const labels = new Map([...card.names, ...card.places].filter(row => row.qid).map(row => [row.qid, row.name]));
        [...card.countries, ...card.nationalities].forEach(row => labels.set(`country:${row.code}`, countryName(row.code)));
        const given = byStory.get(card.storyId);
        return {titles: given?.titles ?? [], text: given?.text ?? '', candidates: countryCandidates(evidence[i], countryOf, labels)};
    });
    // the cards with a candidate, asked together: the choice is by place in that list, back to the place in the cards here
    const toAsk = asked.map((card, index) => ({...card, index})).filter(card => card.candidates.length > 0);
    const answered = choose ? await chooseCountries(toAsk, usage).catch(err => {
        console.error(`Names: the countries of the cards were not chosen by the AI (${err.message})`);
        return new Map();
    }) : new Map();
    const chosen = new Map([...answered].map(([at, codes]) => [toAsk[at].index, codes]));
    return new Map(read.map((card, i) => [card.storyId, {
        names: card.names.map(group => ({name: group.name, qid: group.qid ?? null, kind: group.kind})),
        countries: chosen.get(i) ?? rules[i],
        // for the bench: the rules' countries and the candidates asked
        rules: rules[i],
        candidates: asked[i].candidates,
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
