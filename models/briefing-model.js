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

// Two cards of a ready briefing made one, as the reader chose (see BriefingService.foldNews): the card kept, as it is once the other is folded into
// it, takes the place of the first of the two, the other leaves the briefing with the analysis lines written for it. One statement, as the others.
// $1 the briefing, $2 the user, $3 the story of the card kept, $4 the story of the card folded, $5 the card kept as it is now. Answers where the card
// kept stands in the new list (from 0), nothing when the briefing is not a ready one of this user or has not both cards. Exported for the tests
export const FOLD_ITEMS = `
    UPDATE briefings
    SET items = (SELECT COALESCE(jsonb_agg(CASE WHEN cards.position = first.at THEN $5::jsonb ELSE cards.card END ORDER BY cards.position), '[]'::jsonb)
                 FROM jsonb_array_elements(briefings.items) WITH ORDINALITY AS cards(card, position),
                      (SELECT min(t.position) AS at FROM jsonb_array_elements(briefings.items) WITH ORDINALITY AS t(card, position)
                       WHERE (t.card->>'storyId')::int IN ($3::int, $4::int)) AS first
                 WHERE cards.position = first.at OR (cards.card->>'storyId')::int NOT IN ($3::int, $4::int)),
        analysis = CASE WHEN jsonb_typeof(analysis->'cards') = 'object' THEN jsonb_set(analysis, '{cards}', (analysis->'cards') - ($4::int)::text) ELSE analysis END
    WHERE id = $1::int AND id_user = $2::int AND status = 'ready' AND jsonb_typeof(items) = 'array' AND $3::int <> $4::int
      AND (SELECT count(*) FROM jsonb_array_elements(items) AS card WHERE (card->>'storyId')::int IN ($3::int, $4::int)) = 2
    RETURNING (SELECT (t.position - 1)::int FROM jsonb_array_elements(briefings.items) WITH ORDINALITY AS t(card, position) WHERE (t.card->>'storyId')::int = $3::int) AS "at"`;

// A card of a ready briefing replaced by another at the same place (see BriefingModel.replaceCard). Exported for the tests, which run it in a
// transaction rolled back. $1 the briefing, $2 the user, $3 the story of the card, $4 the new card, $5 its analysis lines ({why, next,
// timeline}, or null), $6 whether the lines of the card are set (null taking them off); the analysis only when it is written
export const REPLACE_CARD = `
        UPDATE briefings
        SET items = (SELECT jsonb_agg(CASE WHEN (item->>'storyId')::int = $3::int THEN $4::jsonb ELSE item END ORDER BY position)
                     FROM jsonb_array_elements(items) WITH ORDINALITY AS cards(item, position)),
            analysis = CASE WHEN $6::boolean AND analysis->>'status' = 'ready' AND jsonb_typeof(analysis->'cards') = 'object'
                            THEN CASE WHEN $5::jsonb IS NULL OR $5::jsonb = 'null'::jsonb THEN analysis #- ARRAY['cards', ($3::int)::text]
                                      ELSE jsonb_set(analysis, ARRAY['cards', ($3::int)::text], $5::jsonb) END
                            ELSE analysis END
        WHERE id = $1::int AND id_user = $2::int AND status = 'ready' AND jsonb_typeof(items) = 'array'
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(items) AS card WHERE (card->>'storyId')::int = $3::int)`;

// The AI version of a card that has none, kept in it (see BriefingModel.setAi). Exported for the tests, which run it in a transaction rolled back. $1 the
// briefing, $2 the user, $3 the story of the card, $4 the version ({points, summary, model}) as JSON
export const SET_AI = `
    UPDATE briefings
    SET items = (SELECT jsonb_agg(CASE WHEN (item->>'storyId')::int = $3::int THEN item || jsonb_build_object('ai', $4::jsonb) ELSE item END ORDER BY position)
                 FROM jsonb_array_elements(items) WITH ORDINALITY AS cards(item, position))
    WHERE id = $1::int AND id_user = $2::int AND status = 'ready' AND jsonb_typeof(items) = 'array'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(items) AS card WHERE (card->>'storyId')::int = $3::int AND jsonb_typeof(card->'ai') IS DISTINCT FROM 'object')`;

export const BriefingModel = {
    // hours: of news it is written from, size: the cards asked for
    create: async (userId, profileId, hours, size) => prisma.briefings.create({data: {id_user: userId, id_profile: profileId, status: 'running', step: 'starting', hours, size}}),

    // the news of the terms the profile follows the reader was shown, noted on its last ready briefing for
    // the directory (see BriefingService.following and DirectoryModel.usage)
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

    // Two cards made one (see FOLD_ITEMS): where the card kept stands in the new list, null when the statement found no such cards
    foldItems: async (userId, briefingId, keepStoryId, dropStoryId, card) => (await prisma.$queryRawUnsafe(FOLD_ITEMS,
        briefingId, userId, keepStoryId, dropStoryId, JSON.stringify(card)))[0]?.at ?? null,

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

    // The cards of the other ready briefings of this user written in the last 'days' (the other profiles of the account) that are one of
    // these stories, their story or one of the stories merged into them: the newest briefing of each profile first. [{briefingId, idProfile,
    // createdAt, storyId, mergedStoryIds, title, leadUrl, source}], the cards of a story only (not the news added by the reader)
    versionsOf: async (userId, exceptId, storyIds, days) => prisma.$queryRawUnsafe(`
        SELECT DISTINCT ON (b.id_profile, (card->>'storyId')::int)
               b.id AS "briefingId", b.id_profile AS "idProfile", b.created_at AS "createdAt", (card->>'storyId')::int AS "storyId",
               CASE WHEN jsonb_typeof(card->'mergedStoryIds') = 'array' THEN card->'mergedStoryIds' ELSE '[]'::jsonb END AS "mergedStoryIds",
               card->>'title' AS title, card->'lead'->>'url' AS "leadUrl", card->'lead'->>'source' AS source
        FROM briefings b,
             jsonb_array_elements(CASE WHEN jsonb_typeof(b.items) = 'array' THEN b.items ELSE '[]'::jsonb END) AS card
        WHERE b.id_user = $1::int AND b.id <> $2::int AND b.status = 'ready' AND b.created_at > now() - make_interval(days => $4::int)
          AND (card->>'storyId')::int > 0
          AND ((card->>'storyId')::int = ANY($3::int[])
               OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(card->'mergedStoryIds') = 'array' THEN card->'mergedStoryIds' ELSE '[]'::jsonb END) AS merged
                          WHERE merged::int = ANY($3::int[])))
        ORDER BY b.id_profile, (card->>'storyId')::int, b.created_at DESC`, userId, exceptId, storyIds, days),

    // The news of the newest ready briefing of each other profile of this user written in the last 'days' (see BriefingService.profilesNews): one row
    // a profile, [{briefingId, idProfile, createdAt, cards}], cards the news in their order, only what the editor of the e-mail lists of each
    // ({number, storyId, ids: its story and the ones merged into it, title, source, language, thumbnail, imported, print: what a reader reads of it
    // (see printOf of card-versions.js), links: the addresses of its lead and its articles}), the card itself staying in the database
    profilesNews: async (userId, exceptId, exceptProfileId, days) => prisma.$queryRawUnsafe(`
        SELECT DISTINCT ON (b.id_profile) b.id AS "briefingId", b.id_profile AS "idProfile", b.created_at AS "createdAt",
               (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                           'number', t.position, 'storyId', (t.card->>'storyId')::int,
                           'ids', jsonb_build_array((t.card->>'storyId')::int) || CASE WHEN jsonb_typeof(t.card->'mergedStoryIds') = 'array' THEN t.card->'mergedStoryIds' ELSE '[]'::jsonb END,
                           'title', COALESCE(t.card->>'titleTranslation', t.card->>'title'), 'source', t.card->'lead'->>'source',
                           'language', t.card->>'language', 'thumbnail', t.card->>'thumbnail',
                           'imported', COALESCE((t.card->>'imported')::boolean, false),
                           'print', jsonb_build_array(t.card->'lead'->>'url', COALESCE(t.card->>'titleTranslation', t.card->>'title'),
                                COALESCE(NULLIF(t.card->>'translation', ''), t.card->>'summary'), COALESCE(NULLIF(t.card->>'pointsTranslation', ''), t.card->>'points'),
                                COALESCE(NULLIF(t.card->>'digestTranslation', ''), t.card->>'digest'), t.card->'ai'->'points', t.card->'ai'->'summary'),
                           'links', (SELECT COALESCE(jsonb_agg(article->>'url'), '[]'::jsonb)
                                     FROM jsonb_array_elements(jsonb_build_array(t.card->'lead')
                                          || CASE WHEN jsonb_typeof(t.card->'articles') = 'array' THEN t.card->'articles' ELSE '[]'::jsonb END) AS article)
                       ) ORDER BY t.position), '[]'::jsonb)
                FROM jsonb_array_elements(CASE WHEN jsonb_typeof(b.items) = 'array' THEN b.items ELSE '[]'::jsonb END) WITH ORDINALITY AS t(card, position)
                WHERE (t.card->>'storyId') IS NOT NULL) AS cards
        FROM briefings b
        WHERE b.id_user = $1::int AND b.id <> $2::int AND b.status = 'ready' AND b.id_profile IS NOT NULL AND b.id_profile IS DISTINCT FROM $3::int
          AND b.created_at > now() - make_interval(days => $4::int)
        ORDER BY b.id_profile, b.created_at DESC`, userId, exceptId, exceptProfileId, days),

    // The card of a story of a ready briefing replaced by another (see BriefingService.useVersion), at the same place; the analysis lines
    // of the card too when 'setLines' (lines null taking them off). One statement, as vote. 0 when the briefing is not a ready one of
    // this user or has no such card
    replaceCard: async (userId, briefingId, storyId, card, {lines = null, setLines = false} = {}) => prisma.$executeRawUnsafe(REPLACE_CARD,
        briefingId, userId, storyId, JSON.stringify(card), lines === null ? null : JSON.stringify(lines), setLines),

    // The analysis lines ({why, next, timeline}) of a card added to a ready briefing of this user, saved with
    // its analysis: only when that analysis is written (a running one is saved whole again by the server
    // writing it, and would lose them). 0 when it is not
    addAnalysisLines: async (userId, briefingId, storyId, lines) => prisma.$executeRawUnsafe(`
        UPDATE briefings
        SET analysis = jsonb_set(analysis, ARRAY['cards', ($3::int)::text], $4::jsonb)
        WHERE id = $1::int AND id_user = $2::int AND status = 'ready' AND analysis->>'status' = 'ready'
          AND jsonb_typeof(analysis->'cards') = 'object'`,
        briefingId, userId, storyId, JSON.stringify(lines)),

    // The analysis of a ready briefing opened again for a card the reader added (the card is read and completed like the others,
    // and its analysis is written after, see analyseImported): 'running', the card among the cards picked, 'importing' counting
    // the cards added whose analysis is being written so that several added in a row are written together. Only when the analysis
    // is written ('ready') or opened this way already; 1 when it is opened, 0 when it is not (the analysis of the cards of the
    // briefing itself still running is saved whole by the server writing it, and would lose it)
    startAnalysisOfAdded: async (userId, briefingId, storyId) => prisma.$transaction(async (tx) => {
        const [row] = await tx.$queryRawUnsafe('SELECT analysis FROM briefings WHERE id = $1::int AND id_user = $2::int AND status = \'ready\' FOR UPDATE', briefingId, userId);
        const analysis = row?.analysis;
        if (!analysis || (analysis.status !== 'ready' && !(analysis.status === 'running' && analysis.importing > 0))) return 0;
        const opened = {...analysis, status: 'running', importing: (analysis.importing ?? 0) + 1, beatAt: new Date().toISOString(),
            picked: [...(analysis.picked ?? []), {storyId, reason: null}]};
        await tx.$executeRawUnsafe('UPDATE briefings SET analysis = $2::jsonb WHERE id = $1::int', briefingId, JSON.stringify(opened));
        return 1;
    }),

    // The analysis lines ({why, next, timeline}) written for such a card, or null when it merits none (taken off the cards picked);
    // the analysis is 'ready' again once every card added has its answer. 0 when the briefing has no such analysis running
    finishAnalysisOfAdded: async (userId, briefingId, storyId, lines) => prisma.$transaction(async (tx) => {
        const [row] = await tx.$queryRawUnsafe('SELECT analysis, items FROM briefings WHERE id = $1::int AND id_user = $2::int FOR UPDATE', briefingId, userId);
        const analysis = row?.analysis;
        if (!analysis || analysis.status !== 'running' || !(analysis.importing > 0)) return 0;
        const importing = analysis.importing - 1;
        // the card taken out of the briefing meanwhile has no lines: the next one added would get its id and its lines
        if (lines && !(Array.isArray(row.items) && row.items.some(card => card.storyId === storyId))) lines = null;
        // a beat only while some are still written: an analysis ready has none (see analysisOfRow)
        const {importing: _open, beatAt: _beat, ...rest} = analysis;
        const done = {...rest, cards: {...(analysis.cards ?? {}), ...(lines ? {[storyId]: lines} : {})},
            picked: (analysis.picked ?? []).filter(entry => lines || entry.storyId !== storyId),
            ...(importing > 0 ? {status: 'running', importing, beatAt: new Date().toISOString()} : {status: 'ready'})};
        await tx.$executeRawUnsafe('UPDATE briefings SET analysis = $2::jsonb WHERE id = $1::int', briefingId, JSON.stringify(done));
        return 1;
    }),

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

    // The AI version of a card that has none ({points, summary, model}, see BriefingService.writeAiVersion), kept in the card. One statement, as the
    // vote: 0 when the briefing is not a ready one of this user, has no such card, or the card has a version already (another call wrote it first)
    setAi: async (userId, briefingId, storyId, ai) => prisma.$executeRawUnsafe(SET_AI, briefingId, userId, storyId, JSON.stringify(ai)),

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
