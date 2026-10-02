//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: profile-service.js
//  Description: The profile of a user: what they want to read in their own words, split into
//               interests by the AI, each with its vector
//

"use strict"

import {ProfileModel} from "../models/profile-model.js";
import {FeedModel} from "../models/feed-model.js";
import {FeedService} from "./feed-service.js";
import {DiscoveryService, JUDGE_THRESHOLD, RELEVANCE_DAYS} from "./discovery-service.js";
import {FeedbackService} from "./feedback-service.js";
import {embed, toSparsevec, toVector} from "./utils/embedder.js";
import {interestsOf} from "./utils/profile-ai.js";
import {TOPICS} from "./utils/topics.js";
import {MAX_PROFILE_FEEDS} from "./utils/feed-limits.js";
import {searchesOfUser} from "./ingest-service.js";
import {readerLanguage} from "./utils/language.js";

const MIN_TEXT = 20;            // "rugby" says too little to split into interests
const MAX_TEXT = 2000;
const MAX_INTEREST_TEXT = 300;

// the themes a user can tick at the start, the ones the AI gives to a news
export const PROFILE_TOPICS = TOPICS.filter(topic => topic !== 'other');

const badRequest = (message) => Object.assign(new Error(message), {status: 400});

const toProfile = (row) => row && ({
    text: row.text,
    topics: row.topics,
    // the language the news are shown in, of every language they are written in
    language: readerLanguage(row),
    discovery: {
        status: row.discovery_status,           // idle, running, done, failed
        error: row.discovery_error,
        at: row.discovered_at,
    },
    updatedAt: row.updated_at,
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

export const ProfileService = {
    topics: () => PROFILE_TOPICS,

    get: async (userId) => {
        const [profile, interests, feeds, refusedSources, relevance, searches] = await Promise.all([
            ProfileModel.get(userId),
            ProfileModel.interests(userId),
            FeedModel.listUserFeeds(userId),
            FeedbackService.refusedSources(userId),
            ProfileModel.profileFeedRelevance(userId, {
                since: new Date(Date.now() - RELEVANCE_DAYS * 24 * 3600e3),
                threshold: JUDGE_THRESHOLD,
            }),
            searchesOfUser(userId),
        ]);
        const relevant = new Map(relevance.map(row => [row.id, row.relevant]));

        return {
            profile: toProfile(profile),
            interests: interests.map(toInterest),
            // the sources found for the profile, the ones added by hand are listed by FeedService (the profile page shows both)
            sources: feeds.filter(feed => feed.origin === 'profile').map(feed => ({
                id: feed.id,
                site: feed.site,
                url: feed.url,
                category: feed.category,
                language: feed.language,
                trusted: feed.trusted ?? false,
                error: feed.last_error ?? null,
                // its news of the last RELEVANCE_DAYS on the interests: at 0 it is removed, once it had the time
                relevant: relevant.get(feed.id) ?? 0,
            })),
            limits: {profileFeeds: MAX_PROFILE_FEEDS, relevanceDays: RELEVANCE_DAYS},
            // the languages the news can be shown in
            languages: FeedService.languages(),
            // the searches of Google News of the interests, read like feeds for this reader only
            googleSearches: searches.length,
            // the sources found for the profile the thumbs of the reader left out: [{url, site, refused, liked}]
            refusedSources,
        };
    },

    // a source left out by the thumbs, kept by the reader: it comes back and is never left out again
    keepSource: async (userId, url) => {
        if (typeof url !== 'string' || !url) throw badRequest('url: the feed to keep.');
        await FeedbackService.keep(userId, url);
        return ProfileService.get(userId);
    },

    // a profile checked and split into interests by the AI, each with its vector, not saved yet: the
    // signup reads it before the account is created, so a text with no interest creates no account
    prepare: async ({text, topics = [], language}) => {
        const written = typeof text === 'string' ? text.trim() : '';
        if (written.length < MIN_TEXT || written.length > MAX_TEXT) {
            throw badRequest(`Describe what you want to read in ${MIN_TEXT} to ${MAX_TEXT} characters.`);
        }
        if (!Array.isArray(topics) || !topics.every(topic => PROFILE_TOPICS.includes(topic))) {
            throw badRequest(`Topics must be among: ${PROFILE_TOPICS.join(', ')}.`);
        }
        if (!FeedService.languages().includes(language)) {
            throw badRequest(`Choose the language you read in among: ${FeedService.languages().join(', ')}.`);
        }

        // the column keeps one language now: the news of every language are read for the reader
        const profile = {text: written, topics: [...new Set(topics)], languages: [language]};
        const interests = await interestsOf({text: written, topics: profile.topics, language, categories: FeedService.categories()});
        if (interests.length === 0) {
            throw Object.assign(new Error('No interest could be read in this text, describe the subjects you want to follow.'), {status: 422});
        }

        return {profile, interests: await withVectors(interests)};
    },

    // a prepared profile saved, and its sources found in background
    store: async (userId, {profile, interests}) => {
        await ProfileModel.save(userId, profile, interests);
        await DiscoveryService.start(userId);
    },

    // the profile written again: the AI splits it into interests, each gets its vector, and the
    // sources are found again in background
    save: async (userId, written) => {
        await ProfileService.store(userId, await ProfileService.prepare(written));
        return ProfileService.get(userId);
    },

    // an interest corrected by the user: a new text gets a new vector
    updateInterest: async (userId, id, {text, weight}) => {
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

        if (await ProfileModel.updateInterest(userId, id, data) === 0) {
            throw Object.assign(new Error('Unknown interest.'), {status: 404});
        }
        return ProfileService.get(userId);
    },

    deleteInterest: async (userId, id) => {
        if (await ProfileModel.deleteInterest(userId, id) === 0) {
            throw Object.assign(new Error('Unknown interest.'), {status: 404});
        }
        return ProfileService.get(userId);
    },

    // the sources found again, with the interests as they are now
    rediscover: async (userId) => {
        if (!await ProfileModel.get(userId)) throw badRequest('Write your profile first.');
        await DiscoveryService.start(userId);
        return ProfileService.get(userId);
    },
};
