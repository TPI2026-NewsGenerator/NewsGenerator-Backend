//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: briefing-model.js
//  Description: Model for the briefings written for a user
//

"use strict"

import {prisma} from '../config/db.js';

export const BriefingModel = {
    // hours: of news it is written from, size: the cards asked for
    create: async (userId, profileId, hours, size) => prisma.briefings.create({data: {id_user: userId, id_profile: profileId, status: 'running', step: 'starting', hours, size}}),

    // the news of the terms the profile follows (see watchedNews)
    watched: async (id, watched) => prisma.briefings.update({where: {id}, data: {watched}}),

    step: async (id, step) => prisma.briefings.update({where: {id}, data: {step}}),

    finish: async (id, items) => prisma.briefings.update({
        where: {id},
        data: {status: 'ready', step: null, items, finished_at: new Date()},
    }),

    fail: async (id, error) => prisma.briefings.update({
        where: {id},
        data: {status: 'failed', step: null, error, finished_at: new Date()},
    }),

    latest: async (profileId) => prisma.briefings.findFirst({
        where: {id_profile: profileId},
        orderBy: {created_at: 'desc'},
    }),

    // a briefing still being written for this profile, if any
    running: async (profileId) => prisma.briefings.findFirst({
        where: {id_profile: profileId, status: 'running'},
        orderBy: {created_at: 'desc'},
    }),

    // the thumb of the reader on a card: 'up', 'down', or null to take it back. One statement, so two
    // calls at the same time both count. 0 when the briefing is not a ready one of this user or has no
    // such card
    vote: async (userId, briefingId, storyId, vote) => prisma.$executeRawUnsafe(`
        UPDATE briefings
        SET items = (SELECT jsonb_agg(CASE WHEN (item->>'storyId')::int = $3
                                          THEN item || jsonb_build_object('vote', $4::text, 'votedAt', CASE WHEN $4::text IS NULL THEN NULL ELSE now() END)
                                          ELSE item END ORDER BY position)
                     FROM jsonb_array_elements(items) WITH ORDINALITY AS cards(item, position))
        WHERE id = $1 AND id_user = $2 AND status = 'ready'
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(items) AS card WHERE (card->>'storyId')::int = $3)`,
        briefingId, userId, storyId, vote),

    // the stories this profile gave a thumb since 'since', the newest vote first: [{title, vote, feedUrls}].
    // One per story, the last one: a card can come back in the next briefing, and two thumbs on it are
    // one opinion, not two refusals of its sources
    votes: async (profileId, since) => (await prisma.$queryRawUnsafe(`
        SELECT title, vote, "feedUrls"
        FROM (SELECT DISTINCT ON (item->>'storyId')
                     item->>'title' AS title, item->>'vote' AS vote, item->'feedUrls' AS "feedUrls",
                     (item->>'votedAt')::timestamptz AS voted_at
              FROM briefings, jsonb_array_elements(items) AS item
              WHERE id_profile = $1 AND status = 'ready' AND item->>'vote' IS NOT NULL
                AND (item->>'votedAt')::timestamptz >= $2::timestamptz
              ORDER BY item->>'storyId', (item->>'votedAt')::timestamptz DESC) AS latest
        ORDER BY voted_at DESC`,
        profileId, since)).map(row => ({...row, feedUrls: Array.isArray(row.feedUrls) ? row.feedUrls : []})),

    // a briefing left 'running' by a server that stopped will never finish
    failAbandoned: async (before) => prisma.briefings.updateMany({
        where: {status: 'running', created_at: {lt: before}},
        data: {status: 'failed', step: null, error: 'The server stopped while writing it.', finished_at: new Date()},
    }),
};
