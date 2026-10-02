//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: profile-model.js
//  Description: Model for the profile of a user, its interests and the feeds found for it
//

"use strict"

import {prisma} from '../config/db.js';

const PUBLIC_INTEREST = {id: true, position: true, text: true, weight: true, keywords: true, sections: true, category: true};

// the vectors of an interest are pgvector columns, Prisma has no type for them: written as text
// (see toVector and toSparsevec in embedder.js) and cast in SQL
const setVectors = (where, params, {dense, sparse}) => prisma.$executeRawUnsafe(
    `UPDATE profile_interests SET dense = $1::vector, sparse = $2::sparsevec WHERE ${where}`,
    dense, sparse, ...params);

export const ProfileModel = {
    get: async (userId) => prisma.user_profiles.findUnique({where: {id_user: userId}}),

    // the interests in their order
    interests: async (userId) => prisma.profile_interests.findMany({
        where: {id_user: userId},
        orderBy: {position: 'asc'},
        select: PUBLIC_INTEREST,
    }),

    // the interests with their searches and their dense vector as text ("[0.1,...]"), to find their sources
    interestsForDiscovery: async (userId) => prisma.$queryRawUnsafe(`
        SELECT id, position, text, weight, keywords, searches, sections, category, dense::text AS dense
        FROM profile_interests
        WHERE id_user = $1::int AND dense IS NOT NULL
        ORDER BY position`,
        userId),

    // the profile and its interests, the old interests replaced at once
    // interests: [{text, weight, keywords, searches, sections, category, dense, sparse}], vectors as text
    save: async (userId, {text, languages}, interests) => prisma.$transaction([
        prisma.user_profiles.upsert({
            where: {id_user: userId},
            create: {id_user: userId, text, languages},
            update: {text, languages, updated_at: new Date()},
        }),
        prisma.profile_interests.deleteMany({where: {id_user: userId}}),
        prisma.profile_interests.createMany({
            data: interests.map(({text, weight, keywords, searches, sections, category}, position) =>
                ({text, weight, keywords, searches, sections, category, id_user: userId, position})),
        }),
        ...interests.map((interest, position) =>
            setVectors('id_user = $3::int AND position = $4::int', [userId, position], interest)),
    ]),

    // one interest changed by the user, only theirs; its vectors when its text changed
    updateInterest: async (userId, id, {dense, sparse, ...data}) => {
        const {count} = await prisma.profile_interests.updateMany({where: {id, id_user: userId}, data});
        if (count > 0 && dense) await setVectors('id = $3::int AND id_user = $4::int', [id, userId], {dense, sparse});
        return count;
    },

    deleteInterest: async (userId, id) => {
        const {count} = await prisma.profile_interests.deleteMany({where: {id, id_user: userId}});
        return count;
    },

    setDiscovery: async (userId, status, error = null) => prisma.user_profiles.update({
        where: {id_user: userId},
        data: {
            discovery_status: status,
            discovery_error: error,
            ...(status === 'done' ? {discovered_at: new Date()} : {}),
        },
    }),

    // the searches of Google News of the interests, each in the language the AI chose for it ("sr:..."):
    // of one user, or of every user. [{searches, category}]
    searchesOf: async (userId = null) => prisma.$queryRawUnsafe(`
        SELECT pi.searches, pi.category
        FROM profile_interests pi
        WHERE $1::int IS NULL OR pi.id_user = $1::int`,
        userId),

    // the feeds the user added by hand: the ones found for the profile take the room left
    ownFeedUrls: async (userId) => (await prisma.user_feeds.findMany({
        where: {id_user: userId, origin: 'user'},
        select: {url: true},
    })).map(feed => feed.url),

    // the feeds the reader kept after their thumbs left them out: never left out again
    keptSources: async (userId) => (await prisma.user_profiles.findUnique({
        where: {id_user: userId},
        select: {kept_sources: true},
    }))?.kept_sources ?? [],

    keepSource: async (userId, url) => prisma.$executeRawUnsafe(`
        UPDATE user_profiles SET kept_sources = array_append(kept_sources, $2)
        WHERE id_user = $1 AND NOT ($2 = ANY(kept_sources))`,
        userId, url),

    // the feeds found for the profile join the ones found before
    // feeds: [{url, site, category, language}]
    addProfileFeeds: async (userId, feeds) => prisma.user_feeds.createMany({
        data: feeds.map(feed => ({...feed, id_user: userId, origin: 'profile'})),
        skipDuplicates: true,           // a feed the user already added by hand stays theirs
    }),

    // Each feed found for the profile, with its news of the last days that got vectors, and how many
    // of them are on one of its interests: their title reaches 'threshold' with it, as when the feed
    // was found (see judgeOf in discovery-service.js), whatever their language: the reader reads them all.
    // [{id, url, site, created_at, news, relevant}]
    profileFeedRelevance: async (userId, {since, threshold}) => prisma.$queryRawUnsafe(`
        SELECT uf.id, uf.url, uf.site, uf.created_at,
               count(a.id)::int AS news,
               count(a.id) FILTER (WHERE EXISTS (
                   SELECT 1 FROM profile_interests i
                   WHERE i.id_user = uf.id_user AND i.dense IS NOT NULL
                     AND -(a.title_dense <#> i.dense) >= $3::real))::int AS relevant
        FROM user_feeds uf
        LEFT JOIN feeds f ON f.url = uf.url
        LEFT JOIN articles a ON a.id_feed = f.id AND a.embedded_at IS NOT NULL AND a.created_at >= $2::timestamptz
        WHERE uf.id_user = $1::int AND uf.origin = 'profile'
        GROUP BY uf.id`,
        userId, since, threshold),

    // only feeds found for the profile of this user, never one added by hand
    deleteProfileFeeds: async (userId, ids) => {
        const {count} = await prisma.user_feeds.deleteMany({where: {id: {in: ids}, id_user: userId, origin: 'profile'}});
        return count;
    },
};
