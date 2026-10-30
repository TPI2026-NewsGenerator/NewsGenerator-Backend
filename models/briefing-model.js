//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: briefing-model.js
//  Description: Model for the briefings written for a user
//

"use strict"

import {prisma} from '../config/db.js';

// the cards of a briefing, and the links of each card (its lead and its articles)
const CARDS = `jsonb_array_elements(items) AS card`;
const LINKS_OF_CARD = `jsonb_array_elements(jsonb_build_array(card->'lead')
    || CASE WHEN jsonb_typeof(card->'articles') = 'array' THEN card->'articles' ELSE '[]'::jsonb END) AS article`;
// A card added by the reader (see addItem). Exported for the tests, which run it in a transaction rolled
// back (tests/briefing/test.add-item.js). $1 the briefing, $2 the user, $3 the card, $4 the cards added at
// most, $5 the links none of its cards may have. A second statement waits for the first to commit and is
// checked again on the items it wrote
export const ADD_ITEM = `
    UPDATE briefings
    SET items = items || jsonb_build_array($3::jsonb || jsonb_build_object('storyId',
            (SELECT LEAST(0, COALESCE(min((card->>'storyId')::int), 0)) - 1 FROM ${CARDS})))
    WHERE id = $1 AND id_user = $2 AND status = 'ready' AND jsonb_typeof(items) = 'array'
      AND (SELECT count(*) FROM ${CARDS} WHERE card->>'imported' = 'true') < $4::int
      AND NOT EXISTS (SELECT 1 FROM ${CARDS}, ${LINKS_OF_CARD} WHERE article->>'url' = ANY($5::text[]))
    RETURNING (items->-1->>'storyId')::int AS "storyId"`;

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

    // the analysis of its cards, saved when it starts and again when written (see card-analysis.js)
    analysis: async (id, analysis) => prisma.briefings.update({where: {id}, data: {analysis}}),

    fail: async (id, error) => prisma.briefings.update({
        where: {id},
        data: {status: 'failed', step: null, error, finished_at: new Date()},
    }),

    // A card added at the end of a ready briefing of this user, its id the next negative one (a news
    // added by the reader is of no story, see importNews), while the briefing has fewer than 'max' cards
    // added and none of these 'links' (as lead or article of a card): one statement, so two added at the
    // same time get two ids, and can't pass 'max' nor add one link twice. Answers that id, null when the
    // briefing is not a ready one of this user, is full or has one of the links
    addItem: async (userId, briefingId, item, {max, links}) => (await prisma.$queryRawUnsafe(ADD_ITEM,
        briefingId, userId, JSON.stringify(item), max, links))[0]?.storyId ?? null,

    // a card added by the reader taken out again (a negative id), with the analysis lines it came with
    // (the next one added gets the same id): 0 when there is none
    removeItem: async (userId, briefingId, storyId) => prisma.$executeRawUnsafe(`
        UPDATE briefings
        SET items = (SELECT COALESCE(jsonb_agg(card ORDER BY position), '[]'::jsonb)
                     FROM jsonb_array_elements(items) WITH ORDINALITY AS cards(card, position)
                     WHERE (card->>'storyId')::int <> $3::int),
            analysis = CASE WHEN jsonb_typeof(analysis->'cards') = 'object'
                            THEN jsonb_set(analysis, '{cards}', (analysis->'cards') - ($3::int)::text) ELSE analysis END
        WHERE id = $1 AND id_user = $2 AND status = 'ready' AND $3::int < 0
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(items) AS card WHERE (card->>'storyId')::int = $3::int)`,
        briefingId, userId, storyId),

    // The card of a news in another ready briefing of this user written in the last 'days' (one of their
    // profiles found it), by its links (as lead or article of the card): a card of a story first, then the
    // newest briefing. {briefingId, idProfile, card, lines}, lines the analysis written for it
    // ({why, next, timeline}) when that briefing has its analysis ready, else null; null when none has it
    cardOfLinks: async (userId, exceptId, links, days) => (await prisma.$queryRawUnsafe(`
        SELECT b.id AS "briefingId", b.id_profile AS "idProfile", card,
               CASE WHEN b.analysis->>'status' = 'ready' THEN b.analysis->'cards'->(card->>'storyId') END AS lines
        FROM briefings b,
             jsonb_array_elements(CASE WHEN jsonb_typeof(b.items) = 'array' THEN b.items ELSE '[]'::jsonb END) AS card
        WHERE b.id_user = $1::int AND b.id <> $2::int AND b.status = 'ready' AND b.created_at > now() - make_interval(days => $4::int)
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(jsonb_build_array(card->'lead')
                  || CASE WHEN jsonb_typeof(card->'articles') = 'array' THEN card->'articles' ELSE '[]'::jsonb END) AS article
              WHERE article->>'url' = ANY($3::text[]))
        ORDER BY ((card->>'storyId')::int > 0) DESC, b.created_at DESC
        LIMIT 1`, userId, exceptId, links, days))[0] ?? null,

    // The analysis lines ({why, next, timeline}) of a card added to a ready briefing of this user, saved with
    // its analysis: only when that analysis is written (a running one is saved whole again by the server
    // writing it, and would lose them). 0 when it is not
    addAnalysisLines: async (userId, briefingId, storyId, lines) => prisma.$executeRawUnsafe(`
        UPDATE briefings
        SET analysis = jsonb_set(analysis, ARRAY['cards', ($3::int)::text], $4::jsonb)
        WHERE id = $1::int AND id_user = $2::int AND status = 'ready' AND analysis->>'status' = 'ready'
          AND jsonb_typeof(analysis->'cards') = 'object'`,
        briefingId, userId, storyId, JSON.stringify(lines)),

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
