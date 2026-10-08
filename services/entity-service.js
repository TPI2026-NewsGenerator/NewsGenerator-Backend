//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: entity-service.js
//  Description: The clubs, people and organisations a profile follows, and the page of each: the news
//               naming it, and the ones naming what it is linked to (the players and the coach of a
//               club, the team of a player), read from every feed with no relevance, as the terms
//               followed (see watchedNews)
//

"use strict"

import {EntityModel} from "../models/entity-model.js";
import {ProfileModel} from "../models/profile-model.js";
import {FeedModel} from "../models/feed-model.js";
import {feedsOf, newsOfTerms} from "./briefing-service.js";
import {isQid, readItem, searchItems} from "./utils/wikidata.js";
import {readerLanguage} from "./utils/language.js";
import {Filter} from "./utils/filter.js";

// Wikidata changes slowly: a squad between two windows of transfers, a coach now and then
const REFRESH_DAYS = 7;
const MAX_FOLLOWED = 30;
const MAX_ADDED_NAMES = 10;
const MAX_NAME = 60;
export const ENTITY_HOURS = [24, 48, 168];
// the linked items whose news are looked for, and the news kept for each on the page
const MAX_LINKS_SEARCHED = 60;
const NEWS_PER_LINK = 30;

const fail = (status, message) => Object.assign(new Error(message), {status});

// The news naming these names, every feed of the profile, no relevance: [{term, count, news}] as the
// terms followed (see newsOfTerms). The names are looked for as plain texts, with and without their
// accents, then checked as whole words (see FeedModel.articlesHolding): 11 s for a club and its people
// on 48 hours, 30 s on a week. Kept a few minutes: the page is opened, then a link, then back
const NEWS_KEPT_MS = 10 * 60e3;
const kept = new Map();         // `${profileId} ${hours} ${names}` -> {at, groups}
const namedNews = async (profileId, names, hours) => {
    const key = `${profileId} ${hours} ${names.join('|')}`;
    const known = kept.get(key);
    if (known && Date.now() - known.at < NEWS_KEPT_MS) return known.groups;
    for (const [other, entry] of kept) if (Date.now() - entry.at >= NEWS_KEPT_MS) kept.delete(other);

    const texts = [...new Set(names.flatMap(name => [name, Filter.withoutAccents(name)]))];
    const articles = await FeedModel.articlesHolding({
        feedUrls: await feedsOf(profileId), texts, since: new Date(Date.now() - hours * 3600e3),
    });
    const groups = newsOfTerms(names, articles);
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
    names: namesFor(row, following),
    followed: Boolean(following),
});

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

    // [{qid, label, description, kind, names, followed, links}], the last followed first
    list: async (profileId) => profileId === null ? [] : (await EntityModel.followed(profileId))
        .map(row => ({...summary(row, row), links: row.links})),

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
        const row = await loaded(qid, await languageOf(profileId));
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
        const found = new Map((await namedNews(profileId, terms, hours)).map(group => [group.term, group]));
        const of = (names, limit) => mergeNews(names.map(name => found.get(name)), limit);

        return {
            entity: {...entity, wikidataNames: row.names, addedNames: following?.added_names ?? [], removedNames: following?.removed_names ?? []},
            hours,
            ...of(entity.names),
            links: links
                .map(link => ({qid: link.qid, label: link.label, description: link.description, kind: link.kind, relation: link.relation,
                    ...of(link.names, NEWS_PER_LINK)}))
                .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
        };
    },
};
