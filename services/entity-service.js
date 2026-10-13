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
import {isQid, readItem, searchItems} from "./utils/wikidata.js";
import {readerLanguage} from "./utils/language.js";
import {Filter} from "./utils/filter.js";
import {cleanWatchTerms, MAX_WATCH_TERMS} from "./utils/watch-terms.js";
import {namesOfCards, shortName, suggestedNames} from "./utils/card-names.js";
import {mapWithConcurrency} from "./utils/concurrency.js";

// Wikidata changes slowly: a squad between two windows of transfers, a coach now and then
const REFRESH_DAYS = 7;
const MAX_FOLLOWED = 30;
const MAX_ADDED_NAMES = 10;
const MAX_NAME = 60;
// the windows of a briefing, 1 to 7 days
export const ENTITY_HOURS = [1, 2, 3, 4, 5, 6, 7].map(days => days * 24);
// the linked items whose news are looked for, and the news kept for each on the page
const MAX_LINKS_SEARCHED = 60;
const NEWS_PER_LINK = 30;
// in the briefing, as for a word (see watchedNews): the newest of each kept, all counted
const BRIEFING_NEWS = 100;
const BRIEFING_CONCURRENCY = 3;
// the cards of these last days the names to follow are taken from, those without names read again
const SUGGESTED_DAYS = 14;
const SUGGESTED_READ = 40;

const fail = (status, message) => Object.assign(new Error(message), {status});

// The news naming these names, every feed of the profile, no relevance: [{term, count, news}] as the
// terms followed (see newsOfTerms), every news counted. The names the tagger found in each news are
// compared (see mentions.js): "LFF", "Gianni Infantino". While news of the window wait for it (a
// backlog, the tagger off), the ones it has not read are looked for in their texts, the names with and
// without their accents, checked as whole words (see FeedModel.articlesHolding: 11 s for a club and its
// people on 48 hours, 30 s on a week); the news of its last minutes are left to it. qids: items of
// Wikidata whose news are those naming any name the tagger linked to them, in any language, under the
// term "@<qid>". Kept a few minutes: the page is opened, then a link, then back
const NEWS_KEPT_MS = 10 * 60e3;
const TAGGER_LATE_MS = 10 * 60e3;
const kept = new Map();         // `${profileId} ${hours} ${names} ${qids}` -> {at, groups}
export const itemTerm = (qid) => `@${qid}`;
const namedNews = async (profileId, names, hours, qids = []) => {
    const key = `${profileId} ${hours} ${names.join('|')} ${qids.join('|')}`;
    const known = kept.get(key);
    if (known && Date.now() - known.at < NEWS_KEPT_MS) return known.groups;
    for (const [other, entry] of kept) if (Date.now() - entry.at >= NEWS_KEPT_MS) kept.delete(other);

    const feedUrls = await feedsOf(profileId);
    const since = new Date(Date.now() - hours * 3600e3);
    const keyOf = new Map(names.map(name => [name, mentionKey(name)]));
    const texts = [...new Set(names.flatMap(name => [name, Filter.withoutAccents(name)]))];
    const [tagged, untagged] = await Promise.all([
        MentionModel.articlesNamed({keys: [...new Set(keyOf.values())].filter(Boolean), qids, feedUrls, since}),
        MentionModel.anyUntagged(since, new Date(Date.now() - TAGGER_LATE_MS))
            .then(waiting => waiting ? FeedModel.articlesHolding({feedUrls, texts, since}) : [])
            .then(articles => articles.filter(article => !article.entities_at)),
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

// a name is searched as an exact phrase (see Filter.parse): its quotes and commas would cut it
const cleanName = (name) => String(name ?? '').replace(/["“”,]/g, ' ').replace(/\s+/g, ' ').trim();

// the names its news are found by for this profile: the ones of Wikidata, with the ones its reader
// added and without the ones they took out
export const namesFor = (row, following) => {
    const removed = new Set((following?.removed_names ?? []).map(name => name.toLowerCase()));
    const seen = new Set();
    return [...row.names, ...(following?.added_names ?? [])].map(cleanName).filter(name => {
        const key = name.toLowerCase();
        if (name.length < 2 || removed.has(key) || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
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
        limits: {entities: MAX_FOLLOWED, words: MAX_WATCH_TERMS},
    }),

    // a name or a word followed as written: every news writing it is in the briefing. {words}
    addWord: async (profileId, word) => {
        const words = await wordsOf(profileId);
        const written = cleanName(word);
        if (words.some(other => sameWord(other, written))) return {words};
        if (words.length >= MAX_WATCH_TERMS) throw fail(400, `You follow ${MAX_WATCH_TERMS} names or words at most.`);
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
        const [qids, words] = await Promise.all([MentionModel.qidsOfKey(mentionKey(written)), profileId === null ? [] : wordsOf(profileId),
            // opened, it is looked for in Wikidata before the others: next time it may be an item
            MentionModel.want({key: mentionKey(written)}).catch(() => 0)]);
        const [group] = await namedNews(profileId, [written], hours);
        return {
            name: written, qid: qids.length === 1 ? qids[0] : null,
            followed: words.some(word => sameWord(word, written)), wordsLeft: Math.max(0, MAX_WATCH_TERMS - words.length),
            hours, count: group?.count ?? 0, news: group?.news ?? [],
        };
    },

    // The news of the items whose news the profile wants in its briefing, one group each: [{term (the
    // name it is shown by), qid, count, news}], as the words' (see watchedNews), BRIEFING_NEWS kept, all counted
    briefingGroups: async (profileId, hours) => {
        const rows = await EntityModel.followed(profileId, {inBriefing: true});
        const done = await mapWithConcurrency(rows, BRIEFING_CONCURRENCY, async (row) => {
            const names = namesFor(row, row);
            const found = new Map((await namedNews(profileId, names, hours, [row.qid])).map(group => [group.term, group]));
            return {term: shortName(row.label, row.names), qid: row.qid, ...mergeNews([...names, itemTerm(row.qid)].map(term => found.get(term)), BRIEFING_NEWS)};
        });
        return done.filter(result => result.status === 'fulfilled').map(result => result.value);
    },

    // What the profile follows as the briefing marks it: [{label, qid, names}], the items in its
    // briefing by their names, then the words, each its own name
    followTerms: async (profileId, words) => [
        ...(profileId === null ? [] : await EntityModel.followed(profileId, {inBriefing: true}))
            .map(row => ({label: shortName(row.label, row.names), qid: row.qid, names: namesFor(row, row)})),
        ...(words ?? []).map(word => ({label: word, qid: null, names: [word]})),
    ],

    follow: async (profileId, qid) => {
        if (profileId === null) throw fail(400, 'Write your profile first.');
        if (await EntityModel.count(profileId) >= MAX_FOLLOWED) throw fail(400, `You follow ${MAX_FOLLOWED} at most.`);
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
