//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: profile-service.js
//  Description: The profiles of a user: what they want to read in their own words, split into
//               interests by the AI, each with its vector. A reader has several profiles, each with
//               its interests, sources and briefings; the one they read is chosen in the page
//

"use strict"

import {ProfileModel} from "../models/profile-model.js";
import {FeedModel} from "../models/feed-model.js";
import {FeedService} from "./feed-service.js";
import {DiscoveryService, JUDGE_THRESHOLD, RELEVANCE_DAYS} from "./discovery-service.js";
import {FeedbackService} from "./feedback-service.js";
import {embed, toSparsevec, toVector} from "./utils/embedder.js";
import {interestsOf} from "./utils/profile-ai.js";
import {isFlood, MAX_PROFILE_FEEDS} from "./utils/feed-limits.js";
import {searchesOfUser} from "./ingest-service.js";
import {readerLanguage} from "./utils/language.js";
import {forClient, sourceKey} from "./utils/public-url.js";
import {cleanWatchTerms, MAX_WATCH_TERMS} from "./utils/watch-terms.js";

const MIN_TEXT = 20;            // "rugby" says too little to split into interests
const MAX_TEXT = 2000;
const MAX_INTEREST_TEXT = 300;
// Each profile has its sources found, read for all the readers, and its briefings, written by the AI:
// a few per reader
export const MAX_PROFILES = 5;
const MAX_NAME = 40;

const badRequest = (message) => Object.assign(new Error(message), {status: 400});
const notFound = (message) => Object.assign(new Error(message), {status: 404});

const toProfile = (row) => row && ({
    id: row.id,
    name: row.name,
    text: row.text,
    // the language the news are shown in, of every language they are written in
    language: readerLanguage(row),
    // what the AI read the reader does not want, in their words: no interest, the briefing leaves it out
    refused: row.refused ?? [],
    // the names or words whose news are always shown, in a section of the briefing of their own
    watchTerms: row.watch_terms ?? [],
    discovery: {
        status: row.discovery_status,           // idle, running, done, failed
        error: row.discovery_error,
        // while it runs: 'google' (the first sources, a few minutes), then 'press' (see DiscoveryService)
        phase: DiscoveryService.phaseOf(row.id),
        at: row.discovered_at,
    },
    updatedAt: row.updated_at,
});

// a source found for the profile the reader removed, as they see it: the address of our RSS-Bridge is
// only ours, the key names it to bring it back (see forClient)
const toRemoved = (source) => ({
    ...forClient(source.url),
    site: source.site,
    category: source.category,
    language: source.language,
});

const toInterest = (interest) => ({
    id: interest.id,
    text: interest.text,
    weight: interest.weight,
    keywords: interest.keywords,
    sections: interest.sections,
    category: interest.category,
});

const withVectors = async (interests) => {
    const vectors = await embed(interests.map(interest => interest.text));
    return interests.map((interest, i) => ({
        ...interest,
        dense: toVector(vectors[i].dense),
        sparse: toSparsevec(vectors[i].sparse),
    }));
};

// the profile of this id, which must be one of this user
const ownProfile = async (userId, profileId) => {
    const profile = Number.isInteger(profileId) ? await ProfileModel.owned(userId, profileId) : null;
    if (!profile) throw notFound('Unknown profile.');
    return profile;
};

const cleanName = (name) => {
    const written = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
    if (!written || written.length > MAX_NAME) throw badRequest(`A profile is named in 1 to ${MAX_NAME} characters.`);
    return written;
};

export const ProfileService = {
    // the profiles of the user, to choose the one read: [{id, name}]
    list: async (userId) => (await ProfileModel.ofUser(userId)).map(row => ({id: row.id, name: row.name})),

    // profileId: the profile shown, null when the user has none yet
    get: async (userId, profileId) => {
        if (profileId === null || profileId === undefined) {
            return {profile: null, profiles: await ProfileService.list(userId), interests: [], sources: [],
                limits: {profileFeeds: MAX_PROFILE_FEEDS, relevanceDays: RELEVANCE_DAYS, profiles: MAX_PROFILES, watchTerms: MAX_WATCH_TERMS},
                languages: FeedService.languages(), googleSearches: 0, refusedSources: [], removedSources: []};
        }
        const [profile, profiles, interests, feeds, refusedSources, relevance, searches, removed] = await Promise.all([
            ownProfile(userId, profileId),
            ProfileService.list(userId),
            ProfileModel.interests(profileId),
            FeedModel.listUserFeeds(profileId),
            FeedbackService.refusedSources(profileId),
            ProfileModel.profileFeedRelevance(profileId, {
                since: new Date(Date.now() - RELEVANCE_DAYS * 24 * 3600e3),
                threshold: JUDGE_THRESHOLD,
            }),
            searchesOfUser(profileId),
            ProfileModel.removedSources(profileId),
        ]);
        const relevant = new Map(relevance.map(row => [row.id, row.relevant]));

        return {
            profile: toProfile(profile),
            // every profile of the reader, to switch to another
            profiles,
            interests: interests.map(toInterest),
            // the sources found for the profile, the ones added by hand are listed by FeedService (the profile page shows both)
            sources: feeds.filter(feed => feed.origin === 'profile').map(feed => ({
                id: feed.id,
                site: feed.site,
                ...forClient(feed.url),
                category: feed.category,
                language: feed.language,
                trusted: feed.trusted ?? false,
                error: feed.last_error ?? null,
                newsPerDay: feed.news_per_day ?? 0,
                flood: isFlood(feed.news_per_day),
                // its news of the last RELEVANCE_DAYS on the interests: at 0 it is removed, once it had the time
                relevant: relevant.get(feed.id) ?? 0,
            })),
            limits: {profileFeeds: MAX_PROFILE_FEEDS, relevanceDays: RELEVANCE_DAYS, profiles: MAX_PROFILES, watchTerms: MAX_WATCH_TERMS},
            // the languages the news can be shown in
            languages: FeedService.languages(),
            // the searches of Google News of the interests, read like feeds for this reader only
            googleSearches: searches.length,
            // the sources found for the profile the thumbs of the reader left out: [{key, url, site, refused, liked}],
            // the key matches them with the sources above and keeps one
            refusedSources: refusedSources.map(source => ({...source, ...forClient(source.url)})),
            // the sources found for the profile the reader removed: never found again, until brought back
            removedSources: removed.map(toRemoved),
        };
    },

    // a source left out by the thumbs, kept by the reader: it comes back and is never left out again
    keepSource: async (userId, profileId, key) => {
        await ownProfile(userId, profileId);
        if (typeof key !== 'string' || !key) throw badRequest('key: the source to keep.');
        await FeedbackService.keep(profileId, key);
        return ProfileService.get(userId, profileId);
    },

    // a source found for the profile removed by the reader: it is remembered, and not found again
    removeSource: async (userId, profileId, id) => {
        await ownProfile(userId, profileId);
        if (!Number.isInteger(id)) throw badRequest('id: the source to remove.');
        if (await ProfileModel.removeProfileFeed(profileId, id) === 0) {
            throw notFound('This source was not found for your profile.');
        }
        return ProfileService.get(userId, profileId);
    },

    // a source the reader removed brought back as it was, by its key (see toRemoved)
    restoreSource: async (userId, profileId, key) => {
        await ownProfile(userId, profileId);
        const source = (await ProfileModel.removedSources(profileId)).find(removed => sourceKey(removed.url) === key);
        if (!source) throw notFound('This source was not removed.');
        await ProfileModel.restoreProfileFeed(profileId, source.url);
        return ProfileService.get(userId, profileId);
    },

    // a profile checked and split into interests by the AI, each with its vector, not saved yet: the
    // signup reads it before the account is created, so a text with no interest creates no account
    prepare: async ({text, language}) => {
        const written = typeof text === 'string' ? text.trim() : '';
        if (written.length < MIN_TEXT || written.length > MAX_TEXT) {
            throw badRequest(`Describe what you want to read in ${MIN_TEXT} to ${MAX_TEXT} characters.`);
        }
        if (!FeedService.languages().includes(language)) {
            throw badRequest(`Choose the language you read in among: ${FeedService.languages().join(', ')}.`);
        }

        // the column keeps one language now: the news of every language are read for the reader
        const {interests, refused} = await interestsOf({text: written, language, categories: FeedService.categories()});
        const profile = {text: written, languages: [language], refused};
        if (interests.length === 0) {
            throw Object.assign(new Error('No interest could be read in this text, describe the subjects you want to follow.'), {status: 422});
        }

        return {profile, interests: await withVectors(interests)};
    },

    // A prepared profile saved, and its sources found in background: profileId null writes a new one.
    // Answers the id of the profile
    store: async (userId, profileId, {profile, interests}) => {
        const id = await ProfileModel.save(userId, profileId, profile, interests);
        await DiscoveryService.start(id);
        return id;
    },

    // the profile written again: the AI splits it into interests, each gets its vector, and the
    // sources are found again in background. A user with no profile yet writes their first one
    save: async (userId, profileId, written) => {
        if (profileId !== null && profileId !== undefined) await ownProfile(userId, profileId);
        const id = await ProfileService.store(userId, profileId ?? null, await ProfileService.prepare(written));
        return ProfileService.get(userId, id);
    },

    // another profile of the user: {name, text, language}, written as the first one
    create: async (userId, {name, ...written}) => {
        const named = cleanName(name);
        if (await ProfileModel.count(userId) >= MAX_PROFILES) throw badRequest(`At most ${MAX_PROFILES} profiles.`);
        const prepared = await ProfileService.prepare(written);
        const id = await ProfileService.store(userId, null, {...prepared, profile: {...prepared.profile, name: named}});
        return ProfileService.get(userId, id);
    },

    rename: async (userId, profileId, name) => {
        await ownProfile(userId, profileId);
        await ProfileModel.rename(profileId, cleanName(name));
        return ProfileService.get(userId, profileId);
    },

    // a profile deleted with its interests, sources and briefings; the last one stays: the reader
    // writes it again instead. Answers the profiles left
    remove: async (userId, profileId) => {
        await ownProfile(userId, profileId);
        if (await ProfileModel.count(userId) <= 1) throw badRequest('Your last profile can be written again, not deleted.');
        await ProfileModel.delete(profileId);
        return {profiles: await ProfileService.list(userId)};
    },

    // the names or words whose news are always shown (see watchedNews in briefing-service.js)
    setWatchTerms: async (userId, profileId, terms) => {
        await ownProfile(userId, profileId);
        await ProfileModel.setWatchTerms(profileId, cleanWatchTerms(terms));
        return ProfileService.get(userId, profileId);
    },

    // an interest corrected by the user: a new text gets a new vector
    updateInterest: async (userId, profileId, id, {text, weight}) => {
        await ownProfile(userId, profileId);
        const data = {};
        if (text !== undefined) {
            const written = typeof text === 'string' ? text.trim() : '';
            if (!written || written.length > MAX_INTEREST_TEXT) throw badRequest(`An interest is 1 to ${MAX_INTEREST_TEXT} characters.`);
            const [vector] = await embed([written]);
            Object.assign(data, {text: written, dense: toVector(vector.dense), sparse: toSparsevec(vector.sparse)});
        }
        if (weight !== undefined) {
            const value = Number(weight);
            if (!Number.isFinite(value) || value < 0.5 || value > 1) throw badRequest('The weight of an interest is between 0.5 and 1.');
            data.weight = value;
        }

        if (await ProfileModel.updateInterest(profileId, id, data) === 0) {
            throw notFound('Unknown interest.');
        }
        return ProfileService.get(userId, profileId);
    },

    deleteInterest: async (userId, profileId, id) => {
        await ownProfile(userId, profileId);
        if (await ProfileModel.deleteInterest(profileId, id) === 0) {
            throw notFound('Unknown interest.');
        }
        return ProfileService.get(userId, profileId);
    },

    // the sources found again, with the interests as they are now
    rediscover: async (userId, profileId) => {
        if (profileId === null || profileId === undefined) throw badRequest('Write your profile first.');
        await ownProfile(userId, profileId);
        await DiscoveryService.start(profileId);
        return ProfileService.get(userId, profileId);
    },
};
