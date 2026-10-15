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

    // [{storyId, names}]: the cards of the ready briefings of a profile of the last days, the ones of a
    // story (not added by the reader), names null on the ones written before they had some
    recentCards: async (profileId, days) => prisma.$queryRawUnsafe(`
        SELECT (card->>'storyId')::int AS "storyId", card->'names' AS names
        FROM briefings b, jsonb_array_elements(CASE WHEN jsonb_typeof(b.items) = 'array' THEN b.items ELSE '[]'::jsonb END) AS card
        WHERE b.id_profile = $1 AND b.status = 'ready' AND b.created_at > now() - make_interval(days => $2::int)
          AND (card->>'storyId')::int > 0`, profileId, days),

    step: async (id, step) => prisma.briefings.update({where: {id}, data: {step}}),

    finish: async (id, items) => prisma.briefings.update({
        where: {id},
        data: {status: 'ready', step: null, items, finished_at: new Date()},
    }),

    // the analysis of its cards, saved when it starts and again when written (see briefing-analysis.js)
    analysis: async (id, analysis) => prisma.briefings.update({where: {id}, data: {analysis}}),

    fail: async (id, error) => prisma.briefings.update({
        where: {id},
        data: {status: 'failed', step: null, error, finished_at: new Date()},
    }),

    // A card added at the end of a ready briefing of this user, its id the next negative one (a news
    // added by the reader is of no story, see importNews): one statement, so two added at the same time
    // get two ids. Answers that id, null when the briefing is not a ready one of this user
    addItem: async (userId, briefingId, item) => (await prisma.$queryRawUnsafe(`
        UPDATE briefings
        SET items = items || jsonb_build_array($3::jsonb || jsonb_build_object('storyId',
                (SELECT LEAST(0, COALESCE(min((card->>'storyId')::int), 0)) - 1 FROM jsonb_array_elements(items) AS card)))
        WHERE id = $1 AND id_user = $2 AND status = 'ready' AND jsonb_typeof(items) = 'array'
        RETURNING (items->-1->>'storyId')::int AS "storyId"`,
        briefingId, userId, JSON.stringify(item)))[0]?.storyId ?? null,

    // a card added by the reader taken out again (a negative id): 0 when there is none
    removeItem: async (userId, briefingId, storyId) => prisma.$executeRawUnsafe(`
        UPDATE briefings
        SET items = (SELECT COALESCE(jsonb_agg(card ORDER BY position), '[]'::jsonb)
                     FROM jsonb_array_elements(items) WITH ORDINALITY AS cards(card, position)
                     WHERE (card->>'storyId')::int <> $3)
        WHERE id = $1 AND id_user = $2 AND status = 'ready' AND $3 < 0
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(items) AS card WHERE (card->>'storyId')::int = $3)`,
        briefingId, userId, storyId),

    // a briefing of this user, null when it is not theirs
    ofUser: async (userId, id) => prisma.briefings.findFirst({where: {id, id_user: userId}}),

    // [{link, thumbnail}]: the pictures the feeds gave the articles of a story, or of these links when
    // the story was emptied since, the newest first
    articlePictures: async (storyId, links) => prisma.$queryRawUnsafe(`
        SELECT link, thumbnail FROM articles
        WHERE (id_story = $1::int OR link = ANY($2::text[])) AND thumbnail IS NOT NULL
        ORDER BY published_at DESC NULLS LAST
        LIMIT 30`, storyId, links),

    // the cards of the briefings of this profile sent by e-mail since 'since', the oldest sent first:
    // [{storyId, mergedStoryIds, title, shownAt}], shownAt their last sending, the title as the reader
    // read it (see repeats.js). Only these were read (the user, 14.10.2026: a card not sent is not read)
    sentSince: async (profileId, since) => prisma.$queryRawUnsafe(`
        SELECT (item->>'storyId')::int AS "storyId", item->'mergedStoryIds' AS "mergedStoryIds",
               COALESCE(item->>'titleTranslation', item->>'title') AS title, (item->>'sentAt')::timestamptz AS "shownAt"
        FROM briefings b, jsonb_array_elements(b.items) AS item
        WHERE b.id_profile = $1::int AND b.status = 'ready' AND jsonb_typeof(b.items) = 'array'
          AND item->>'sentAt' IS NOT NULL AND (item->>'sentAt')::timestamptz >= $2::timestamptz
        ORDER BY "shownAt"`,
        profileId, since),

    // the cards of a ready briefing of this user just sent by e-mail, marked with the time: their stories
    // are not shown again for a while (see sentSince). One statement, as vote
    markSent: async (userId, briefingId, storyIds) => prisma.$executeRawUnsafe(`
        UPDATE briefings
        SET items = (SELECT jsonb_agg(CASE WHEN (item->>'storyId')::int = ANY($3::int[])
                                          THEN item || jsonb_build_object('sentAt', now())
                                          ELSE item END ORDER BY position)
                     FROM jsonb_array_elements(items) WITH ORDINALITY AS cards(item, position))
        WHERE id = $1 AND id_user = $2 AND status = 'ready' AND jsonb_typeof(items) = 'array'`,
        briefingId, userId, storyIds),

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
