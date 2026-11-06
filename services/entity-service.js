//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: entity-service.js
//  Description: What a profile follows, in one list (the user, 13.10.2026): the clubs, people and
//               organisations of Wikidata, and the names or words as written (its watch terms). The page
//               of each item: the news naming it, and the ones naming what it is linked to (the players
//               and the coach of a club, the team of a player); the page of a name Wikidata does not
//               have; the names of the reader's cards to follow; and the news of all of them in the
//               briefing, read from every feed with no relevance
//

"use strict"

import {EntityModel} from "../models/entity-model.js";
import {BriefingModel} from "../models/briefing-model.js";
import {ProfileModel} from "../models/profile-model.js";
import {FeedModel} from "../models/feed-model.js";
import {MentionModel} from "../models/mention-model.js";
import {feedsOf, namingTerm, newsOfTerms} from "./briefing-service.js";
import {mentionKey} from "./utils/mentions.js";
import {candidatesFor, describeItems, isQid, PERSON_SITELINKS, readItem, searchItems, SITELINKS_AHEAD} from "./utils/wikidata.js";
import {readerLanguage} from "./utils/language.js";
import {Filter} from "./utils/filter.js";
import {cleanWatchTerms} from "./utils/watch-terms.js";
import {mayName} from "./utils/name-prefilter.js";
import {holdsTheme, themeOf} from "./utils/profile-theme.js";
import {namesOfCards, shortName, suggestedNames} from "./utils/card-names.js";
import {mapWithConcurrency} from "./utils/concurrency.js";
import {memo} from "./utils/memo.js";
import {cleanName, namesFor, searchNamesFor} from "./utils/watch-names.js";

// the names a followed item is searched by (see utils/watch-names.js), exported from here as before
export {namesFor, searchNamesFor};

// Wikidata changes slowly: a squad between two windows of transfers, a coach now and then
const REFRESH_DAYS = 7;
// what a profile follows in all, the items of Wikidata and the names or words as written (300 since 2.11.2026,
// 30 items and 20 words before): the briefing reads them by lots, see briefingGroups
export const MAX_FOLLOWED = 300;
const MAX_ADDED_NAMES = 10;
const MAX_NAME = 60;
// the windows of a briefing, 1 to 7 days
export const ENTITY_HOURS = [1, 2, 3, 4, 5, 6, 7].map(days => days * 24);
// the linked items whose news are looked for, and the news kept for each on the page
const MAX_LINKS_SEARCHED = 60;
const NEWS_PER_LINK = 30;
// in the briefing, as for a word (see watchedNews): the newest of each kept, all counted
const BRIEFING_NEWS = 100;
// from this many names the news the tagger has not read are not asked of the database by their texts (one
// ILIKE each: 2,400 for 300 names), they are all read and the names looked for in memory (see untaggedNaming)
const TEXT_ASKED_MAX = 30;
// The words searched in the texts of the news (see wordsGroups) are few: the database answers each in 0.3 to
// 0.6 s whatever its window (25 names, 15 s on a day and 31 s on a month, even for names met once), the
// window being read again at each step. Lots of this many at once, this many at most
const WORDS_PER_SEARCH = 10;
const TEXT_WORDS_MAX = 30;
// the cards of these last days the names to follow are taken from, those without names read again
const SUGGESTED_DAYS = 14;
const SUGGESTED_READ = 40;

// A list of names to follow (an Excel file, see the client): checked by lots, a few names a request (Wikidata
// answers one call every 0.4 s whoever asks, 300 names are two minutes), then followed in one request
const CHECK_MAX = 10;
const CHOICES_MAX = 8;
// A request ends after this long even with names left: behind the server stand Caddy and the tunnel of
// Cloudflare, which answer with a page of HTML after about 100 s (524), and a name takes up to 30 s when Wikidata
// is slow (two searches of 15 s). The answer tells the first names only, the client asks the others again
const CHECK_BUDGET_MS = 30e3;
// What Wikidata said of a name (the items it may be) and of an item (the Wikipedias it is in) is kept: a list
// imported twice, or carried on after a pause, does not ask again. They are not worth much of a day
const KEPT_LOOKUPS_MS = 6 * 3600e3;
const candidates = memo({ttlMs: KEPT_LOOKUPS_MS, max: 5000});
const wikipedias = memo({ttlMs: KEPT_LOOKUPS_MS, max: 20000});
export const forgetLookups = () => {
    candidates.clear();
    wikipedias.clear();
};
// How long a client should wait after Wikidata stopped a search (ms): what it asked for, between 2 s and 2 min,
// 30 s when it did not say
const waitOf = (err) => Math.min(Math.max(err?.retryIn ?? 30e3, 2e3), 120e3);

// Of several items a name may be, the one that stands out: in at least PERSON_SITELINKS Wikipedias and in
// SITELINKS_AHEAD times more than any other, whatever it is (a person, a club, a place); null when none does.
// items: [{qid, links}]. "Kylian Mbappé" has a book and a character beside the footballer, "Real Madrid" a small
// Argentine club called so beside the club of Madrid, "Michael Oliver" a referee, an actor and an academic of the
// same weight
export const dominantOf = (items) => {
    const [first, second] = [...items].sort((a, b) => b.links - a.links);
    return first && first.links >= PERSON_SITELINKS && first.links >= SITELINKS_AHEAD * (second?.links ?? 0) ? first.qid : null;
};

// Of namesakes none of which stands out, the one of the theme of the profile (see profile-theme.js): the only one
// whose description holds a word of it ("Spanish football manager" for a profile of football), or the one that
// stands out among those that do; not when another is far ahead of it in Wikipedias, a footballer who has a famous
// namesake of another trade is left to the reader. candidates: [{qid, description}], called what the reader wrote;
// weight: Map qid -> Wikipedias. {item, word} or null
const themedOf = (candidates, weight, theme) => {
    const themed = candidates.filter(item => weight.has(item.qid) && holdsTheme(theme, item.description));
    const [item] = themed.length === 1 ? themed
        : themed.filter(candidate => candidate.qid === dominantOf(themed.map(found => ({qid: found.qid, links: weight.get(found.qid)}))));
    const best = Math.max(0, ...weight.values());
    return item && SITELINKS_AHEAD * weight.get(item.qid) >= best ? {item, word: holdsTheme(theme, item.description)} : null;
};

// the theme of a profile; none when its interests cannot be read, the doubts are then left to the reader
const themeOfProfile = async (profileId) => {
    try {
        return themeOf(await ProfileModel.interests(profileId));
    } catch (err) {
        console.error(`Entities: the theme of the profile ${profileId} not read (${err.message})`);
        return [];
    }
};

const fail = (status, message) => Object.assign(new Error(message), {status});

// The news naming these names, every feed of the profile, no relevance: [{term, count, news}] as the
// terms followed (see newsOfTerms), every news counted. The names the tagger found in each news are
// compared (see mentions.js): "LFF", "Gianni Infantino". While news of the window wait for it (a
// backlog, the tagger off), the ones it has not read are looked for in their texts, the names with and
// without their accents, checked as whole words (see FeedModel.articlesHolding: 11 s for a club and its
// people on 48 hours, 30 s on a week; only the news it has not read are asked for, 28 of the 12,683 news
// naming the UEFA in 30 days); the news of its last minutes are left to it. qids: items of
// Wikidata whose news are those naming any name the tagger linked to them, in any language, under the
// term "@<qid>". Kept a few minutes: the page is opened, then a link, then back
const NEWS_KEPT_MS = 10 * 60e3;
const TAGGER_LATE_MS = 10 * 60e3;
const kept = new Map();         // `${profileId} ${hours} ${names} ${qids}` -> {at, groups}

// the news of the window the tagger has not read that may name one of these names, as articlesHolding
// gives them: asked by their texts for a few names, all read and filtered in memory for many
const untaggedNaming = async (feedUrls, names, since) => {
    if (names.length <= TEXT_ASKED_MAX) {
        const texts = [...new Set(names.flatMap(name => [name, Filter.withoutAccents(name)]))];
        return FeedModel.articlesHolding({feedUrls, texts, since, untagged: true});
    }
    return (await FeedModel.untaggedArticles({feedUrls, since})).filter(mayName(names));
};
export const itemTerm = (qid) => `@${qid}`;
const namedNews = async (profileId, names, hours, qids = []) => {
    const key = `${profileId} ${hours} ${names.join('|')} ${qids.join('|')}`;
    const known = kept.get(key);
    if (known && Date.now() - known.at < NEWS_KEPT_MS) return known.groups;
    for (const [other, entry] of kept) if (Date.now() - entry.at >= NEWS_KEPT_MS) kept.delete(other);

    const feedUrls = await feedsOf(profileId);
    const since = new Date(Date.now() - hours * 3600e3);
    const keyOf = new Map(names.map(name => [name, mentionKey(name)]));
    const [tagged, untagged] = await Promise.all([
        MentionModel.articlesNamed({keys: [...new Set(keyOf.values())].filter(Boolean), qids, feedUrls, since}),
        MentionModel.anyUntagged(since, new Date(Date.now() - TAGGER_LATE_MS))
            .then(waiting => waiting ? untaggedNaming(feedUrls, names, since) : []),
    ]);
    const articles = [...tagged, ...untagged]
        .sort((a, b) => (b.published_at ?? b.created_at) - (a.published_at ?? a.created_at));
    // a news tagged names what the tagger found in it, one not yet what its text holds
    const holds = (term) => {
        if (term.startsWith('@')) return (article) => article.qids?.includes(term.slice(1)) ?? false;
        const inText = namingTerm(term);
        return (article) => article.keys ? article.keys.includes(keyOf.get(term)) : inText(article);
    };
    const groups = newsOfTerms([...names, ...qids.map(itemTerm)], articles, {limit: Infinity, holds});
    kept.set(key, {at: Date.now(), groups});
    return groups;
};

const languageOf = async (profileId) => profileId ? readerLanguage(await ProfileModel.get(profileId) ?? {}) : 'en';

const fresh = (row) => row?.fetched_at && Date.now() - new Date(row.fetched_at).getTime() < REFRESH_DAYS * 24 * 3600e3;

// the row of an item read in full: from Wikidata when it is not known yet, or only as a link, or read
// too long ago. Wikidata not answering, the row known is used as it is
const loaded = async (qid, language) => {
    if (!isQid(qid)) throw fail(400, 'An item of Wikidata, like Q483020.');
    const known = await EntityModel.byQid(qid);
    if (fresh(known)) return known;
    let item;
    try {
        item = await readItem(qid, language);
    } catch (err) {
        console.error(`Entities: ${qid} not read from Wikidata (${err.message})`);
        if (known) return known;
        throw fail(502, 'Wikidata could not be read, try again in a moment.');
    }
    if (!item) throw fail(404, 'Wikidata has no such item.');
    await EntityModel.save(item);
    return EntityModel.byQid(qid);
};

// Which one-word names of the persons followed are the name of many people: the family names that this many first words
// carry among the persons the tagger met (measured on 2.26 million names of 6.11.2026: García 581, Rodríguez 566, Silva 470,
// Müller 189, Velasco 64, then Messi 38, Infantino 22, Čeferin 7, Kuipers 7, Rosetti 4). Their news are found by the full names
// and by the item the tagger links, not by the family name alone. Kept a day; a database that does not answer leaves every name
// searched, as before (a false news is better than a missing one when nothing is known)
export const COMMON_NAME_FIRSTS = 50;
const spreads = memo({ttlMs: 24 * 3600e3, max: 20000});
export const commonNames = async (rows) => {
    const keys = [...new Set(rows.filter(row => row.kind === 'person' && /\s/.test(String(row.label ?? '').trim()))
        .flatMap(row => namesFor(row, row)).filter(name => !/\s/.test(name)).map(mentionKey).filter(Boolean))];
    const unknown = keys.filter(key => spreads.get(key) === undefined);
    if (unknown.length > 0) {
        try {
            const found = await MentionModel.surnameSpread(unknown);
            unknown.forEach(key => spreads.set(key, found.get(key) ?? 0));
        } catch (err) {
            console.error(`Entities: the family names were not counted (${err.message})`);
        }
    }
    return new Set(keys.filter(key => (spreads.get(key) ?? 0) >= COMMON_NAME_FIRSTS));
};

const summary = (row, following) => ({
    qid: row.qid, label: row.label, description: row.description, kind: row.kind,
    // the name it is shown by in lists and tabs: "UEFA" (see shortName)
    short: shortName(row.label, row.names),
    names: namesFor(row, following),
    followed: Boolean(following),
    // its news in the briefing of the profile (see briefingGroups)
    inBriefing: Boolean(following?.in_briefing),
});

// The news naming these words in their texts over the last 'hours', by lots: [{term, count, news}], all
// counted. A news is a candidate when its text holds the word as it is or without its accents, and kept when it
// names it as a whole word (see newsOfTerms)
const textNews = async (profileId, words, hours) => {
    if (words.length === 0) return [];
    const feedUrls = await feedsOf(profileId);
    const since = new Date(Date.now() - hours * 3600e3);
    const lots = Array.from({length: Math.ceil(words.length / WORDS_PER_SEARCH)}, (_, i) => words.slice(i * WORDS_PER_SEARCH, (i + 1) * WORDS_PER_SEARCH));
    const done = await mapWithConcurrency(lots, 3, async (lot) => {
        const texts = [...new Set(lot.flatMap(word => [word, Filter.withoutAccents(word)]))];
        return newsOfTerms(lot, await FeedModel.articlesHolding({feedUrls, texts, since}), {limit: Infinity});
    });
    const failed = done.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    return done.flatMap(result => result.value);
};

// The items followed from a list are rows with their label alone: read in full from Wikidata one after the
// other, behind the one running (a call every 0.4 s whoever asks, the readers' searches go between), so that
// their names, kind and links come in minutes. Wikidata asking to wait, the same item is asked again after
// it, twice at most. Lost with a restart of the server: the item is read in full when its page is opened
let filling = Promise.resolve();
const fillItems = (qids, language) => {
    filling = filling.then(async () => {
        for (const qid of qids) {
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const item = await readItem(qid, language);
                    if (item) await EntityModel.save(item);
                    break;
                } catch (err) {
                    console.error(`Entities: ${qid} not read from Wikidata (${err.message})`);
                    if (!err.paused) break;
                    await new Promise(resolve => setTimeout(resolve, Math.min(err.retryIn || 30e3, 120e3)));
                }
            }
        }
    }).catch(err => console.error(`Entities: the items followed were not read (${err.message})`));
};

const wordsOf = async (profileId) => (await ProfileModel.get(profileId))?.watch_terms ?? [];
const sameWord = (a, b) => a.toLowerCase() === b.toLowerCase();

// the news of several names as one list: once each, the newest first. groups: of watchedNews
export const mergeNews = (groups, limit = Infinity) => {
    const byUrl = new Map();
    for (const group of groups) {
        for (const news of group?.news ?? []) {
            const known = byUrl.get(news.url);
            if (!known) byUrl.set(news.url, {...news, names: [group.term]});
            else if (!known.names.includes(group.term)) known.names.push(group.term);
        }
    }
    const stories = new Set();
    const news = [...byUrl.values()]
        .sort((a, b) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')))
        // one news per story: the newest of the ones naming it
        .filter(item => item.storyId === null || item.storyId === undefined || !stories.has(item.storyId) && stories.add(item.storyId));
    return {count: news.length, news: news.slice(0, limit)};
};

export const EntityService = {
    // [{qid, label, description}]: the items of Wikidata named so
    search: async (profileId, q) => {
        try {
            return await searchItems(q, await languageOf(profileId));
        } catch (err) {
            console.error(`Entities: Wikidata not searched (${err.message})`);
            throw fail(502, 'Wikidata could not be searched, try again in a moment.');
        }
    },

    // [{qid, label, description, kind, names, followed, inBriefing, links}], the last followed first
    list: async (profileId) => profileId === null ? [] : (await EntityModel.followed(profileId))
        .map(row => ({...summary(row, row), links: row.links})),

    // {entities, words, limits}: everything the profile follows, the items and the words
    all: async (profileId) => ({
        entities: await EntityService.list(profileId),
        words: profileId === null ? [] : await wordsOf(profileId),
        limits: {total: MAX_FOLLOWED},
    }),

    // a name or a word followed as written: every news writing it is in the briefing. {words}
    addWord: async (profileId, word) => {
        const words = await wordsOf(profileId);
        const written = cleanName(word);
        if (words.some(other => sameWord(other, written))) return {words};
        if (words.length + await EntityModel.count(profileId) >= MAX_FOLLOWED) throw fail(400, `You follow ${MAX_FOLLOWED} names at most.`);
        const kept = cleanWatchTerms([...words, written]);
        await ProfileModel.setWatchTerms(profileId, kept);
        return {words: kept};
    },

    removeWord: async (profileId, word) => {
        const words = await wordsOf(profileId);
        const kept = words.filter(other => !sameWord(other, String(word ?? '')));
        if (kept.length === words.length) throw fail(404, 'You do not follow it.');
        await ProfileModel.setWatchTerms(profileId, kept);
        return {words: kept};
    },

    // its news in the briefing of the profile or not, of an item followed
    setInBriefing: async (profileId, qid, on) => {
        if (typeof on !== 'boolean') throw fail(400, 'on: true or false.');
        const row = isQid(qid) ? await EntityModel.byQid(qid) : null;
        if (!row || await EntityModel.setInBriefing(profileId, row.id, on) === 0) throw fail(404, 'You do not follow it.');
        return summary(row, await EntityModel.following(profileId, row.id));
    },

    // What a list of names makes: each name, one after the other, looked for in Wikidata in the language of the
    // reader. [{name, status, item?, items?}] in the order given, status:
    // - 'known': already followed, as an item (by one of its names) or as written;
    // - 'linked': Wikidata has one item for it, item {qid, label, description} (the ones called exactly so, then
    //   the ones named so at the start; the pages of a family or given name left aside); or several and one
    //   stands out by far, in Wikipedias (see dominantOf), and is called with that name, told by famous: true;
    //   or none stands out and one, called so, is of the theme of the profile (the only one whose description holds a
    //   word of its interests, "football"; not when another is 3 times better known), told by themed: that word;
    // - 'choose': several and none stands out, items [..] (8 at most, the ones of the theme of the profile first, then
    //   the best known in Wikipedias, the ones found only by an alias counting half): the reader says which, or none;
    // - 'word': none, to follow as written;
    // - 'invalid': 2 to 60 characters are a name.
    // 'names': CHECK_MAX at most a request. The answer tells the first names, at least one: the ones left when
    // the request has taken CHECK_BUDGET_MS are not looked for, and Wikidata stopping the search (it asks to wait,
    // is slow, does not answer) leaves the names after the last told, with retryIn: the milliseconds to wait before
    // asking them again. Nothing is lost: a request that fails on its first name is a 502 that carries retryIn too.
    // {results, retryIn?}
    checkNames: async (profileId, names, {budgetMs = CHECK_BUDGET_MS} = {}) => {
        if (profileId === null) throw fail(400, 'Write your profile first.');
        if (!Array.isArray(names) || names.length === 0 || names.length > CHECK_MAX || !names.every(name => typeof name === 'string')) {
            throw fail(400, `names: 1 to ${CHECK_MAX} names.`);
        }
        const language = await languageOf(profileId);
        const [rows, words] = await Promise.all([EntityModel.followed(profileId), wordsOf(profileId)]);
        const known = new Set([...rows.flatMap(row => namesFor(row, row)), ...words].map(mentionKey).filter(Boolean));
        // each name looked for, one after the other (a call every 0.4 s, whoever asks)
        const entries = [];
        let retryIn = null;
        const started = Date.now();
        for (const name of names) {
            if (entries.length > 0 && Date.now() - started > budgetMs) break;
            const written = cleanName(name);
            if (written.length < 2 || written.length > MAX_NAME) {
                entries.push({name: written.slice(0, MAX_NAME), status: 'invalid'});
            } else if (known.has(mentionKey(written))) {
                entries.push({name: written, status: 'known'});
            } else {
                const key = `${language} ${mentionKey(written)}`;
                let found = candidates.get(key);
                if (!found) {
                    try {
                        found = await candidatesFor(written, language);
                        candidates.set(key, found);
                    } catch (err) {
                        console.error(`Entities: "${written}" not looked for in Wikidata (${err.message})`);
                        retryIn = waitOf(err);
                        break;
                    }
                }
                const pool = [...found.exact, ...found.others];
                entries.push(pool.length === 0 ? {name: written, status: 'word'}
                    : pool.length === 1 ? {name: written, status: 'linked', item: pool[0]}
                    : {name: written, status: 'choose', pool});
            }
        }
        // a doubt: the item that stands out settles it. The Wikipedias of the items of all the doubts are counted
        // together, 50 items a call. When they cannot be counted the doubts are not answered (and the names after
        // the first of them, which the client asks again): the reader would be asked about names that are clear
        const links = new Map();
        const qids = [...new Set(entries.filter(entry => entry.status === 'choose').flatMap(entry => entry.pool.map(item => item.qid)))];
        for (const qid of qids) if (wikipedias.get(qid) !== undefined) links.set(qid, wikipedias.get(qid));
        const toCount = qids.filter(qid => !links.has(qid));
        for (let i = 0; i < toCount.length; i += 50) {
            try {
                for (const item of await describeItems(toCount.slice(i, i + 50), {batch: 50})) {
                    links.set(item.qid, item.links);
                    wikipedias.set(item.qid, item.links);
                }
            } catch (err) {
                console.error(`Entities: the namesakes were not told apart (${err.message})`);
                retryIn = waitOf(err);
                entries.length = Math.max(0, entries.findIndex(entry => entry.status === 'choose'));
                break;
            }
        }
        if (entries.length === 0) {
            throw Object.assign(fail(502, 'Wikidata could not be searched, try again in a moment.'), {retryIn: retryIn ?? waitOf(null)});
        }
        const theme = qids.length > 0 ? await themeOfProfile(profileId) : [];
        const results = entries.map(({pool, ...entry}) => {
            if (!pool) return entry;
            // it must be called what the reader wrote, not only known by it: "LFF" is an alias of a league of Lithuania
            // far ahead of the others in Wikipedias, and no name of it. An item found only by an alias counts for half
            // its Wikipedias against the others: "Pep Guardiola" (95) is an alias of Néstor Gorosito (49), called
            // otherwise, and must not stand in the way of the coach
            const called = (item) => mentionKey(item.label).includes(mentionKey(entry.name));
            const weighed = pool.filter(item => links.has(item.qid)).map(item => ({qid: item.qid, links: links.get(item.qid) * (called(item) ? 1 : 0.5)}));
            const standing = dominantOf(weighed);
            const item = pool.find(candidate => candidate.qid === standing && called(candidate));
            if (item) return {...entry, status: 'linked', item, famous: true};
            // none stands out: the one of the theme of the profile, if there is one
            const weight = new Map(weighed.map(found => [found.qid, found.links]));
            const themed = themedOf(pool.filter(called), weight, theme);
            if (themed) return {...entry, status: 'linked', item: themed.item, themed: themed.word};
            // the ones to choose from, the ones of the theme first, the best known first
            const ofTheme = (candidate) => holdsTheme(theme, candidate.description) ? 1 : 0;
            return {...entry, items: [...pool].sort((a, b) => ofTheme(b) - ofTheme(a) || (weight.get(b.qid) ?? 0) - (weight.get(a.qid) ?? 0)).slice(0, CHOICES_MAX)};
        });
        return retryIn === null ? {results} : {results, retryIn};
    },

    // A list of names followed at once: qids, the items of Wikidata (300 at most), words, the names to follow as
    // written. What does not fit in MAX_FOLLOWED is left out, the items first. The items Wikidata has are
    // followed with their label alone (their row is complete once read in full, in background: three calls
    // each, minutes for a list, see fillItems); the ones it does not have are left out.
    // {added: {items, words}, left: {full, missing, invalid}, entities, words, limits}
    importNames: async (profileId, {qids = [], words = []} = {}) => {
        if (profileId === null) throw fail(400, 'Write your profile first.');
        if (!Array.isArray(qids) || !Array.isArray(words) || qids.length + words.length > 2 * MAX_FOLLOWED
            || !qids.every(qid => isQid(qid)) || !words.every(word => typeof word === 'string')) {
            throw fail(400, 'qids: items of Wikidata, words: names, 600 at most.');
        }
        const [rows, current] = await Promise.all([EntityModel.followed(profileId), wordsOf(profileId)]);
        const room = MAX_FOLLOWED - rows.length - current.length;
        if (room <= 0) throw fail(400, `You follow ${MAX_FOLLOWED} names at most.`);

        const followedQids = new Set(rows.map(row => row.qid));
        const newQids = [...new Set(qids)].filter(qid => !followedQids.has(qid));
        const written = words.map(cleanName);
        const valid = written.filter(word => word.length >= 2 && word.length <= MAX_NAME);
        const taken = new Set(current.map(word => word.toLowerCase()));
        const newWords = valid.filter(word => !taken.has(word.toLowerCase()) && taken.add(word.toLowerCase()));

        const itemsTaken = newQids.slice(0, room);
        const wordsTaken = newWords.slice(0, room - itemsTaken.length);
        // the items Wikidata has, with their label: the ones the database does not know yet are described, 50 a call
        const knownRows = await EntityModel.byQids(itemsTaken);
        const known = new Set(knownRows.map(row => row.qid));
        const unknown = itemsTaken.filter(qid => !known.has(qid));
        const described = [];
        for (let i = 0; i < unknown.length; i += 50) {
            try {
                described.push(...await describeItems(unknown.slice(i, i + 50), {batch: 50}));
            } catch (err) {
                console.error(`Entities: items not described by Wikidata (${err.message})`);
                throw Object.assign(fail(502, 'Wikidata could not be read, try again in a moment.'), {retryIn: waitOf(err)});
            }
        }
        await EntityModel.addNamed(described.map(item => ({qid: item.qid, label: item.label, description: item.description || null})));
        const existing = [...known, ...described.map(item => item.qid)];
        await EntityModel.followMany(profileId, existing);
        if (wordsTaken.length > 0) await ProfileModel.setWatchTerms(profileId, cleanWatchTerms([...current, ...wordsTaken]));

        // the rows only named are read in full, one after the other, behind the reader
        const unread = [...knownRows.filter(row => !row.fetched_at).map(row => row.qid), ...described.map(item => item.qid)];
        if (unread.length > 0) fillItems(unread, await languageOf(profileId));
        return {
            added: {items: existing.length, words: wordsTaken.length},
            left: {full: newQids.length - itemsTaken.length + newWords.length - wordsTaken.length, missing: itemsTaken.length - existing.length,
                invalid: written.length - valid.length},
            ...await EntityService.all(profileId),
        };
    },

    // The names met on several cards of the reader's briefings of the last days that they follow neither
    // as an item nor as a word: [{name, qid, kind, cards}]. The cards written before they had names get
    // them from the news of their story now
    suggestions: async (profileId) => {
        if (profileId === null) return [];
        const [cards, followed, words] = await Promise.all([BriefingModel.recentCards(profileId, SUGGESTED_DAYS),
            EntityModel.followed(profileId), wordsOf(profileId)]);
        const unread = [...new Set(cards.filter(card => !Array.isArray(card.names)).map(card => card.storyId))].slice(0, SUGGESTED_READ);
        const read = await namesOfCards((await MentionModel.articlesOfStories(unread)).map(row => ({storyId: row.id_story, ids: row.ids})));
        // a story shown in two briefings is one card
        const byStory = new Map();
        for (const card of cards) if (!byStory.has(card.storyId)) byStory.set(card.storyId, Array.isArray(card.names) ? card.names : read.get(card.storyId));
        const names = [...byStory.values()];
        return suggestedNames(names.filter(Boolean), {qids: followed.map(row => row.qid), words});
    },

    // The page of a name Wikidata does not have, or not as one item ("LFF", "Vadims Ļašenko"): {name, qid,
    // followed, wordsLeft, hours, count, news}, its news of the last hours. qid: the item the tagger linked
    // it to, the page to open instead
    namePage: async (profileId, name, hours = 48) => {
        if (!ENTITY_HOURS.includes(hours)) throw fail(400, `hours: ${ENTITY_HOURS.join(', ')}.`);
        const written = cleanName(name);
        if (written.length < 2 || written.length > MAX_NAME) throw fail(400, `A name of 2 to ${MAX_NAME} characters.`);
        const [qids, words, items] = await Promise.all([MentionModel.qidsOfKey(mentionKey(written)), profileId === null ? [] : wordsOf(profileId),
            profileId === null ? 0 : EntityModel.count(profileId),
            // opened, it is looked for in Wikidata before the others: next time it may be an item
            MentionModel.want({key: mentionKey(written)}).catch(() => 0)]);
        const [group] = await namedNews(profileId, [written], hours);
        return {
            name: written, qid: qids.length === 1 ? qids[0] : null,
            followed: words.some(word => sameWord(word, written)), wordsLeft: Math.max(0, MAX_FOLLOWED - items - words.length),
            hours, count: group?.count ?? 0, news: group?.news ?? [],
        };
    },

    // The news of the items whose news the profile wants in its briefing, one group each: [{term (the
    // name it is shown by), qid, count, news}], as the words' (see watchedNews), 'limit' news kept (BRIEFING_NEWS
    // by default), all counted over the last 'hours'. only: the qids of the items to read, all of them when null
    // (the briefing reads those with too few news again over a longer window, see untilEnough)
    briefingGroups: async (profileId, hours, {limit = BRIEFING_NEWS, only = null} = {}) => {
        const rows = (await EntityModel.followed(profileId, {inBriefing: true})).filter(row => only === null || only.includes(row.qid));
        if (rows.length === 0) return [];
        // all the items in one search: 300 of them, one each, were 300 searches of the database
        const common = await commonNames(rows);
        const namesOf = new Map(rows.map(row => [row.qid, searchNamesFor(row, row, common)]));
        const found = new Map((await namedNews(profileId, [...new Set([...namesOf.values()].flat())], hours, rows.map(row => row.qid)))
            .map(group => [group.term, group]));
        return rows.map(row => ({term: shortName(row.label, row.names), qid: row.qid,
            ...mergeNews([...namesOf.get(row.qid), itemTerm(row.qid)].map(term => found.get(term)), limit)}));
    },

    // The news of the names or words as written the profile follows: [{term, count, news}], one group each,
    // 'limit' news kept, all counted over the last 'hours'. Two ways, for what each does well:
    // - by the names the tagger found in the news (accents and case aside, as for an item), and the news it
    //   has not read yet by their texts: the names of persons, bodies and places;
    // - by the texts of every news, as a whole word, for the generic words and the acronyms ("VAR", "derby":
    //   one word in lower case or in capitals), which the tagger meets in a quarter of their news and under
    //   three kinds ("var" is a place, a body and a person, and the key forgets the capitals of an acronym), and
    //   for the names it never met, TEXT_WORDS_MAX at most, the first in the order they are followed.
    // A generic word beyond them is searched by the tagger's names
    wordsGroups: async (profileId, words, hours, {limit = BRIEFING_NEWS} = {}) => {
        if (words.length === 0) return [];
        const generic = (word) => !/\s/.test(word) && (word === word.toLowerCase() || word === word.toUpperCase());
        const seen = await MentionModel.seenOf([...new Set(words.filter(word => !generic(word)).map(mentionKey))]);
        const texted = new Set([...words.filter(generic), ...words.filter(word => !generic(word) && !seen.has(mentionKey(word)))].slice(0, TEXT_WORDS_MAX));
        const named = words.filter(word => !(generic(word) && texted.has(word)));
        const [tagged, text] = await Promise.all([named.length > 0 ? namedNews(profileId, named, hours) : [], textNews(profileId, [...texted], hours)]);
        const byTerm = new Map(tagged.map(group => [group.term, group]));
        const byText = new Map(text.map(group => [group.term, group]));
        return words.map(word => ({term: word, ...mergeNews([byTerm.get(word), byText.get(word)], limit)}));
    },

    // What the profile follows as the briefing marks it: [{label, qid, names}], the items in its
    // briefing by their names, then the words, each its own name
    followTerms: async (profileId, words) => {
        const rows = profileId === null ? [] : await EntityModel.followed(profileId, {inBriefing: true});
        const common = await commonNames(rows);
        return [
            ...rows.map(row => ({label: shortName(row.label, row.names), qid: row.qid, names: searchNamesFor(row, row, common)})),
            ...(words ?? []).map(word => ({label: word, qid: null, names: [word]})),
        ];
    },

    follow: async (profileId, qid) => {
        if (profileId === null) throw fail(400, 'Write your profile first.');
        if (await EntityModel.count(profileId) + (await wordsOf(profileId)).length >= MAX_FOLLOWED) throw fail(400, `You follow ${MAX_FOLLOWED} names at most.`);
        const row = await loaded(qid, await languageOf(profileId));
        await EntityModel.follow(profileId, row.id);
        return EntityService.list(profileId);
    },

    unfollow: async (profileId, qid) => {
        const row = isQid(qid) ? await EntityModel.byQid(qid) : null;
        if (!row || await EntityModel.unfollow(profileId, row.id) === 0) throw fail(404, 'You do not follow it.');
        return EntityService.list(profileId);
    },

    // added: names of the reader (10 at most); removed: names of Wikidata taken out. Of an item followed
    setNames: async (profileId, qid, {added, removed} = {}) => {
        const row = isQid(qid) ? await EntityModel.byQid(qid) : null;
        const following = row ? await EntityModel.following(profileId, row.id) : null;
        if (!following) throw fail(404, 'You do not follow it.');
        if (!Array.isArray(added) || !Array.isArray(removed) || ![...added, ...removed].every(name => typeof name === 'string')) {
            throw fail(400, 'added and removed: lists of names.');
        }
        const own = [...new Set(added.map(cleanName).filter(name => name.length >= 2 && name.length <= MAX_NAME))];
        if (own.length > MAX_ADDED_NAMES) throw fail(400, `${MAX_ADDED_NAMES} names of yours at most.`);
        const known = new Set(row.names.map(name => name.toLowerCase()));
        await EntityModel.setNames(profileId, row.id, own, [...new Set(removed.filter(name => known.has(name.toLowerCase())))]);
        return summary(row, await EntityModel.following(profileId, row.id));
    },


    // The page of an item: {entity, hours, count, news, links: [{qid, label, description, kind, relation,
    // count, news}]}, the news of the last hours naming it, and of each item it links to, the most named
    // first. Of any item, followed or not: a player of a club is opened from the page of the club
    page: async (profileId, qid, hours = 48) => {
        if (!ENTITY_HOURS.includes(hours)) throw fail(400, `hours: ${ENTITY_HOURS.join(', ')}.`);
        const profile = profileId === null ? null : await ProfileModel.get(profileId);
        const row = await loaded(qid, profileId ? readerLanguage(profile ?? {}) : 'en');
        const following = profileId === null ? null : await EntityModel.following(profileId, row.id);
        const entity = summary(row, following);
        // an item linked twice (the FIFA, parent and member of the UEFA) is one link of both relations
        const byQid = new Map();
        for (const link of await EntityModel.links(row.id)) {
            const known = byQid.get(link.qid);
            if (known) known.relation = `${known.relation}, ${link.relation}`;
            else byQid.set(link.qid, {...link});
        }
        const links = [...byQid.values()].slice(0, MAX_LINKS_SEARCHED)
            .map(link => ({...link, names: namesFor(link.names.length > 0 ? link : {...link, names: [link.label]}, null)}));

        const terms = [...new Set([...entity.names, ...links.flatMap(link => link.names)])];
        const qids = [...new Set([row.qid, ...links.map(link => link.qid)])];
        const found = new Map((await namedNews(profileId, terms, hours, qids)).map(group => [group.term, group]));
        // its names, and the names the tagger linked to it (its labels in the other languages of the news)
        const of = (names, qid, limit) => mergeNews([...names, itemTerm(qid)].map(name => found.get(name)), limit);

        return {
            entity: {...entity, wikidataNames: row.names, addedNames: following?.added_names ?? [], removedNames: following?.removed_names ?? []},
            hours,
            ...of(entity.names, row.qid),
            links: links
                .map(link => ({qid: link.qid, label: link.label, description: link.description, kind: link.kind, relation: link.relation,
                    ...of(link.names, link.qid, NEWS_PER_LINK)}))
                .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
        };
    },
};
