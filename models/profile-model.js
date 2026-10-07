//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: profile-model.js
//  Description: Model for the profiles of a user, their interests and the feeds found for them
//
//  A reader has several profiles (db/add_profiles.sql), each with its interests, its sources and its
//  briefings. What belongs to a profile is read by the id of the profile; the id of the user is
//  written with it, and checked where the user asks for a profile by its id
//

"use strict"

import {prisma} from '../config/db.js';

const PUBLIC_INTEREST = {id: true, position: true, text: true, weight: true, keywords: true, sections: true, category: true};

// the vectors of an interest are pgvector columns, Prisma has no type for them: written as text
// (see toVector and toSparsevec in embedder.js) and cast in SQL
const setVectors = (where, params, {dense, sparse}) => prisma.$executeRawUnsafe(
    `UPDATE profile_interests SET dense = $1::vector, sparse = $2::sparsevec WHERE ${where}`,
    dense, sparse, ...params);

// The feeds found for the profile the reader removes, kept in user_profiles.removed_sources as they were.
// Exported for the tests, which run them in a transaction rolled back (tests/sources/test.removed-sources.js)
// $1 the profile, $2 the id of the feed: removed and remembered in one statement
export const REMOVE_PROFILE_FEED = `
    WITH gone AS (
        DELETE FROM user_feeds WHERE id = $2::int AND id_profile = $1::int AND origin = 'profile'
        RETURNING url, site, category, language
    )
    UPDATE user_profiles p
    SET removed_sources = p.removed_sources || (SELECT jsonb_agg(to_jsonb(gone)) FROM gone)
    WHERE p.id = $1::int AND EXISTS (SELECT 1 FROM gone)`;
// $1 the profile, $2 the url of a feed removed: forgotten and found for the profile again
export const RESTORE_PROFILE_FEED = `
    WITH back AS (
        SELECT p.id_user, s FROM user_profiles p, jsonb_array_elements(p.removed_sources) s
        WHERE p.id = $1::int AND s->>'url' = $2
    ), forgotten AS (
        UPDATE user_profiles p
        SET removed_sources = (SELECT COALESCE(jsonb_agg(s), '[]'::jsonb) FROM jsonb_array_elements(p.removed_sources) s WHERE s->>'url' <> $2)
        WHERE p.id = $1::int AND EXISTS (SELECT 1 FROM back)
    )
    INSERT INTO user_feeds (id_user, id_profile, url, site, category, language, origin)
    SELECT id_user, $1::int, s->>'url', s->>'site', s->>'category', s->>'language', 'profile' FROM back
    ON CONFLICT (id_profile, url) DO NOTHING`;

export const ProfileModel = {
    get: async (profileId) => prisma.user_profiles.findUnique({where: {id: profileId}}),

    // the profiles of a user, the first written first: [{id, name, text, ...}]
    ofUser: async (userId) => prisma.user_profiles.findMany({where: {id_user: userId}, orderBy: {id: 'asc'}}),

    // the ids of the profiles of a user, the first written first
    idsOf: async (userId) => (await prisma.user_profiles.findMany({
        where: {id_user: userId}, orderBy: {id: 'asc'}, select: {id: true},
    })).map(row => row.id),

    // the profile of this id if it is one of this user, null otherwise
    owned: async (userId, profileId) => prisma.user_profiles.findFirst({where: {id: profileId, id_user: userId}}),

    count: async (userId) => prisma.user_profiles.count({where: {id_user: userId}}),

    rename: async (profileId, name) => prisma.user_profiles.update({where: {id: profileId}, data: {name}}),

    // its interests, sources and briefings go with it (db/add_profiles.sql, ON DELETE CASCADE)
    delete: async (profileId) => prisma.user_profiles.delete({where: {id: profileId}}),

    setWatchTerms: async (profileId, terms) => prisma.user_profiles.update({where: {id: profileId}, data: {watch_terms: terms}}),

    // the interests in their order
    interests: async (profileId) => prisma.profile_interests.findMany({
        where: {id_profile: profileId},
        orderBy: {position: 'asc'},
        select: PUBLIC_INTEREST,
    }),

    // the interests with their searches and their dense vector as text ("[0.1,...]"), to find their sources
    interestsForDiscovery: async (profileId) => prisma.$queryRawUnsafe(`
        SELECT id, position, text, weight, keywords, searches, sections, category, dense::text AS dense
        FROM profile_interests
        WHERE id_profile = $1::int AND dense IS NOT NULL
        ORDER BY position`,
        profileId),

    // A profile and its interests, the old interests replaced at once: profileId null writes a new
    // profile of the user, named 'name'. Answers the id of the profile
    // interests: [{text, weight, keywords, searches, sections, category, dense, sparse}], vectors as text
    save: async (userId, profileId, {text, languages, refused = [], name}, interests) => {
        const id = profileId ?? (await prisma.user_profiles.create({
            data: {id_user: userId, text, languages, refused, ...(name ? {name} : {})},
        })).id;
        await prisma.$transaction([
            prisma.user_profiles.update({
                where: {id},
                data: {text, languages, refused, updated_at: new Date(), ...(name ? {name} : {})},
            }),
            prisma.profile_interests.deleteMany({where: {id_profile: id}}),
            prisma.profile_interests.createMany({
                data: interests.map(({text, weight, keywords, searches, sections, category}, position) =>
                    ({text, weight, keywords, searches, sections, category, id_user: userId, id_profile: id, position})),
            }),
            ...interests.map((interest, position) =>
                setVectors('id_profile = $3::int AND position = $4::int', [id, position], interest)),
        ]);
        return id;
    },

    // one interest changed by the user, only one of this profile; its vectors when its text changed
    updateInterest: async (profileId, id, {dense, sparse, ...data}) => {
        const {count} = await prisma.profile_interests.updateMany({where: {id, id_profile: profileId}, data});
        if (count > 0 && dense) await setVectors('id = $3::int AND id_profile = $4::int', [id, profileId], {dense, sparse});
        return count;
    },

    deleteInterest: async (profileId, id) => {
        const {count} = await prisma.profile_interests.deleteMany({where: {id, id_profile: profileId}});
        return count;
    },

    // the profiles whose discovery is said running
    discovering: async () => (await prisma.user_profiles.findMany({
        where: {discovery_status: 'running'},
        select: {id: true},
    })).map(row => row.id),

    setDiscovery: async (profileId, status, error = null) => prisma.user_profiles.update({
        where: {id: profileId},
        data: {
            discovery_status: status,
            discovery_error: error,
            ...(status === 'done' ? {discovered_at: new Date()} : {}),
        },
    }),

    // the searches of Google News of the interests, each in the language the AI chose for it ("sr:..."):
    // of one profile, or of every profile. [{searches, category}]
    searchesOf: async (profileId = null) => prisma.$queryRawUnsafe(`
        SELECT pi.searches, pi.category
        FROM profile_interests pi
        WHERE $1::int IS NULL OR pi.id_profile = $1::int`,
        profileId),

    // the feeds the user added by hand to this profile: the ones found for it take the room left
    ownFeedUrls: async (profileId) => (await prisma.user_feeds.findMany({
        where: {id_profile: profileId, origin: 'user'},
        select: {url: true},
    })).map(feed => feed.url),

    // the feeds the reader kept after their thumbs left them out: never left out again
    keptSources: async (profileId) => (await prisma.user_profiles.findUnique({
        where: {id: profileId},
        select: {kept_sources: true},
    }))?.kept_sources ?? [],

    keepSource: async (profileId, url) => prisma.$executeRawUnsafe(`
        UPDATE user_profiles SET kept_sources = array_append(kept_sources, $2)
        WHERE id = $1 AND NOT ($2 = ANY(kept_sources))`,
        profileId, url),

    // the feeds found for the profile the reader removed: [{url, site, category, language}]
    removedSources: async (profileId) => (await prisma.$queryRawUnsafe(
        'SELECT removed_sources FROM user_profiles WHERE id = $1::int', profileId))[0]?.removed_sources ?? [],

    // a feed found for the profile removed by the reader, and remembered: it is not found again. Only one
    // of this profile found for it; answers 0 when there is none
    removeProfileFeed: async (profileId, id) => prisma.$executeRawUnsafe(REMOVE_PROFILE_FEED, profileId, id),

    // a feed the reader removed brought back as it was; answers 0 when it was not removed
    restoreProfileFeed: async (profileId, url) => prisma.$executeRawUnsafe(RESTORE_PROFILE_FEED, profileId, url),

    // the feeds found for the profile join the ones found before
    // feeds: [{url, site, category, language}]
    addProfileFeeds: async (userId, profileId, feeds) => prisma.user_feeds.createMany({
        data: feeds.map(feed => ({...feed, id_user: userId, id_profile: profileId, origin: 'profile'})),
        skipDuplicates: true,           // a feed the user already added by hand stays theirs
    }),

    // Each feed found for the profile, with its news of the last days that got vectors, and how many
    // of them are on one of its interests: their title and the start of their description reach
    // 'threshold' with it, the text the feed was found on (see subjectStats in site-sections.js),
    // whatever their language: the reader reads them all. On the title alone, phoronix.com was found for
    // low-level code and removed the same day, its titles at 0.44 at best (bench/prune-text.mjs: 3 of
    // 113 feeds found removed on the title, none on the text)
    // [{id, url, site, created_at, news, relevant}]
    profileFeedRelevance: async (profileId, {since, threshold}) => prisma.$queryRawUnsafe(`
        SELECT uf.id, uf.url, uf.site, uf.created_at,
               count(a.id)::int AS news,
               count(a.id) FILTER (WHERE EXISTS (
                   SELECT 1 FROM profile_interests i
                   WHERE i.id_profile = uf.id_profile AND i.dense IS NOT NULL
                     AND -(a.text_dense <#> i.dense) >= $3::real))::int AS relevant
        FROM user_feeds uf
        LEFT JOIN feeds f ON f.url = uf.url
        LEFT JOIN articles a ON a.id_feed = f.id AND a.embedded_at IS NOT NULL AND a.created_at >= $2::timestamptz
        WHERE uf.id_profile = $1::int AND uf.origin = 'profile'
        GROUP BY uf.id`,
        profileId, since, threshold),

    // only feeds found for this profile, never one added by hand
    deleteProfileFeeds: async (profileId, ids) => {
        const {count} = await prisma.user_feeds.deleteMany({where: {id: {in: ids}, id_profile: profileId, origin: 'profile'}});
        return count;
    },
};
