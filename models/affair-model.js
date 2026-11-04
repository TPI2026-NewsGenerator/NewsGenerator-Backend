//
//  Author: Fabian Rostello
//  Date: 04.11.2026
//  File: affair-model.js
//  Description: The stories that may belong to one affair, read from the database where their vectors are
//

"use strict"

import {prisma} from '../config/db.js';

export const AffairModel = {
    // The stories that may belong to the affair of a story: the ones of its thread (the affair as the grouping
    // saw it, in one language, db/add_threads.sql) and the 'perStory' closest by their centroid of the last
    // 'days', in any language (the same affair told in Spanish is another thread). Each once, with its likeness
    // to the story: [{id, via, likeness}], via 'thread' for the first. The closest ones are an exact scan of
    // the stories of the days: 4 to 6 s over 30 days (1.8 million stories, 4.11.2026), which is why an affair
    // is built once and kept (see AffairService)
    candidates: async ({storyId, days, perStory}) => prisma.$queryRawUnsafe(`
        WITH seed AS (SELECT id, id_thread, centroid FROM stories WHERE id = $1 AND centroid IS NOT NULL),
        mates AS (
            SELECT o.id, 'thread' AS via, COALESCE(-(o.centroid <#> (SELECT centroid FROM seed))::real, 0) AS likeness
            FROM stories o WHERE o.id_thread = (SELECT id_thread FROM seed)),
        close AS (
            SELECT o.id, 'close' AS via, -(o.centroid <#> (SELECT centroid FROM seed))::real AS likeness
            FROM stories o
            WHERE o.centroid IS NOT NULL AND o.updated_at >= now() - make_interval(days => $2::int)
            ORDER BY o.centroid <#> (SELECT centroid FROM seed)
            LIMIT $3::int OFFSET 0)
        SELECT DISTINCT ON (id) id, via, likeness FROM (SELECT * FROM mates UNION ALL SELECT * FROM close) pool
        ORDER BY id, via DESC`,
        storyId, days, perStory),

    // How big the thread of each of these stories is (db/add_threads.sql): [{id, stories, media}], the stories
    // that have a thread only. A card whose thread is small is no affair yet, whatever the AI would say of it
    threadStats: async (storyIds) => storyIds.length === 0 ? [] : prisma.$queryRawUnsafe(`
        SELECT s.id, t.n_stories AS stories, cardinality(t.media) AS media
        FROM stories s JOIN threads t ON t.id = s.id_thread
        WHERE s.id = ANY($1::int[])`, storyIds),

    // The stories of these ids: [{id, lang, id_thread, created_at}]. When a story was created is when we saw its
    // first news, a date the feeds cannot get wrong (see datedAt in affair-events.js)
    stories: async (storyIds) => storyIds.length === 0 ? [] : prisma.$queryRawUnsafe(
        'SELECT id, lang, id_thread, created_at FROM stories WHERE id = ANY($1::int[])', storyIds),

    // The news of these stories the reader can read, all of them (the coverage counts the media of every
    // language), without the text of their page: [{id, id_story, link, title, description, lang, medium,
    // source_url, resolved_link, thumbnail, feed_url, at}], the oldest first. A story of many media is a
    // few hundred rows: the descriptions are cut
    newsOf: async ({storyIds, feedUrls, since}) => storyIds.length === 0 ? [] : prisma.$queryRawUnsafe(`
        SELECT * FROM (
            SELECT DISTINCT ON (a.id_story, a.link)
                   a.id, a.id_story, a.link, a.title, left(a.description, 400) AS description, a.lang, a.medium,
                   a.source_url, a.resolved_link, a.thumbnail, f.url AS feed_url,
                   COALESCE(a.published_at, a.created_at) AS at
            FROM articles a
            JOIN feeds f ON f.id = a.id_feed
            WHERE a.id_story = ANY($1::int[])
              AND f.url = ANY($2::text[])
              AND COALESCE(a.published_at, a.created_at) >= $3::timestamptz
            ORDER BY a.id_story, a.link, COALESCE(a.published_at, a.created_at)
        ) news
        ORDER BY at`,
        storyIds, feedUrls, since),

    // --- the affairs a reader follows (db/add_affairs.sql) ---

    // The stories created in ]since, until] that may belong to a followed affair (its stories: storyIds): the ones of its
    // threads, and the ones close to the centroid of its stories in any language, none of its own. Only the new stories are compared (a few thousand
    // in a quarter of an hour), never the month: [{id, likeness}], the closest first. A story is updated when it is
    // created, so the index of updated_at finds them (created_at has none: 6 s over the 1.8 million stories)
    fresh: async ({storyIds, threadIds, since, until, excluded, likeness, limit}) => prisma.$queryRawUnsafe(`
        WITH a AS (SELECT l2_normalize(avg(centroid))::halfvec(1024) AS centroid FROM stories WHERE id = ANY($1::int[]) AND centroid IS NOT NULL)
        SELECT o.id, -(o.centroid <#> a.centroid)::real AS likeness
        FROM a
        JOIN stories o ON o.updated_at >= $2::timestamptz AND o.created_at > $2::timestamptz AND o.created_at <= $3::timestamptz AND o.centroid IS NOT NULL
        WHERE a.centroid IS NOT NULL AND NOT o.id = ANY($4::int[])
          AND (o.id_thread = ANY($5::int[]) OR -(o.centroid <#> a.centroid) >= $6::real)
        ORDER BY o.centroid <#> a.centroid
        LIMIT $7::int`,
        storyIds, since, until, excluded, threadIds, likeness, limit),

    // the threads these stories are in
    threadsOf: async (storyIds) => storyIds.length === 0 ? [] : (await prisma.$queryRawUnsafe(
        'SELECT DISTINCT id_thread FROM stories WHERE id = ANY($1::int[]) AND id_thread IS NOT NULL', storyIds)).map(row => row.id_thread),

    // the affairs of a reader, the newest event first: [{id, title, language, created_at, last_event_at, seen_at, view, unread}]
    followedBy: async (userId) => prisma.$queryRawUnsafe(`
        SELECT a.id, a.id_profile, a.title, a.language, a.anchor_story, a.created_at, a.last_event_at, a.seen_at, a.view,
               (SELECT count(*)::int FROM affair_alerts l WHERE l.id_affair = a.id AND l.read_at IS NULL) AS unread
        FROM affairs a WHERE a.id_user = $1::int
        ORDER BY COALESCE(a.last_event_at, a.created_at) DESC`, userId),

    // one affair of a reader, null when it is not theirs
    followedOne: async (userId, id) => (await prisma.$queryRawUnsafe(`
        SELECT a.id, a.id_user, a.id_profile, a.title, a.language, a.about, a.not_about, a.anchor_story, a.story_ids, a.created_at,
               a.checked_at, a.last_event_at, a.seen_at, a.view
        FROM affairs a WHERE a.id = $1::int AND a.id_user = $2::int`, id, userId))[0] ?? null,

    // every affair followed, the ones not checked for the longest first, for the watch
    followedAll: async () => prisma.$queryRawUnsafe(`
        SELECT a.id, a.id_user, a.id_profile, a.title, a.language, a.about, a.not_about, a.anchor_story, a.story_ids,
               a.created_at, a.checked_at, a.last_event_at, a.view
        FROM affairs a ORDER BY a.checked_at`),

    // the affair of this reader that holds one of these stories among its events, its id, else null: a card of an
    // affair already followed is not followed twice
    followedHolding: async (userId, storyIds) => (await prisma.$queryRawUnsafe(
        'SELECT id FROM affairs WHERE id_user = $1::int AND story_ids && $2::int[] LIMIT 1', userId, storyIds))[0]?.id ?? null,

    // the affairs of a reader with their stories: which cards are an affair already followed
    followedStories: async (userId) => prisma.$queryRawUnsafe('SELECT id, anchor_story, story_ids FROM affairs WHERE id_user = $1::int', userId),

    countFollowed: async (userId) => (await prisma.$queryRawUnsafe('SELECT count(*)::int AS n FROM affairs WHERE id_user = $1::int', userId))[0].n,

    // The affair followed, checked from checkedAt on (when its view
    // was built: the stories created since are the first to judge). Answers its id
    follow: async ({userId, profileId, title, language, about, notAbout, anchorStory, storyIds, view, at, checkedAt}) => (await prisma.$queryRawUnsafe(`
        INSERT INTO affairs (id_user, id_profile, title, language, about, not_about, anchor_story, story_ids, view, last_event_at, checked_at)
        VALUES ($1::int, $2::int, $3, $4, $5, $6, $7::int, $8::int[], $9::jsonb, $10::timestamptz, $11::timestamptz)
        RETURNING id`,
        userId, profileId, title, language, about, notAbout, anchorStory, storyIds, JSON.stringify(view), at, checkedAt))[0].id,

    // what a check found: its events and coverage, its stories, when it ran
    saveCheck: async (id, {view, storyIds, checkedAt, lastEventAt}) => prisma.$executeRawUnsafe(`
        UPDATE affairs SET view = $2::jsonb, story_ids = $3::int[], checked_at = $4::timestamptz,
               last_event_at = COALESCE($5::timestamptz, last_event_at)
        WHERE id = $1::int`,
        id, JSON.stringify(view), storyIds, checkedAt, lastEventAt),

    // its view only (the titles of its events translated again, see AffairService.detail)
    saveView: async (id, view) => prisma.$executeRawUnsafe('UPDATE affairs SET view = $2::jsonb WHERE id = $1::int', id, JSON.stringify(view)),

    // the reader stops following it: its alerts go with it. 0 when it is not theirs
    unfollow: async (userId, id) => prisma.$executeRawUnsafe('DELETE FROM affairs WHERE id = $1::int AND id_user = $2::int', id, userId),

    // the reader opened it: its alerts are read
    markSeen: async (userId, id) => {
        const opened = await prisma.$executeRawUnsafe('UPDATE affairs SET seen_at = now() WHERE id = $1::int AND id_user = $2::int', id, userId);
        if (opened > 0) await prisma.$executeRawUnsafe('UPDATE affair_alerts SET read_at = now() WHERE id_affair = $1::int AND read_at IS NULL', id);
        return opened;
    },

    // --- the alerts ---

    // alerts [{event}] of an affair
    addAlerts: async (affairId, userId, events) => events.length === 0 ? 0 : prisma.$executeRawUnsafe(`
        INSERT INTO affair_alerts (id_affair, id_user, event) SELECT $1::int, $2::int, e FROM jsonb_array_elements($3::jsonb) AS e`,
        affairId, userId, JSON.stringify(events)),

    // the alerts of an affair, the newest first: [{id, event, created_at, read_at}]
    alertsOf: async (affairId, limit = 50) => prisma.$queryRawUnsafe(
        'SELECT id, event, created_at, read_at FROM affair_alerts WHERE id_affair = $1::int ORDER BY created_at DESC LIMIT $2::int', affairId, limit),

    // how many alerts the reader has not read, over all their affairs
    unreadOf: async (userId) => (await prisma.$queryRawUnsafe(
        'SELECT count(*)::int AS n FROM affair_alerts WHERE id_user = $1::int AND read_at IS NULL', userId))[0].n,

    // the alerts not yet sent to the devices of this reader: [{id, id_affair, title, event}]
    unpushed: async (userId) => prisma.$queryRawUnsafe(`
        SELECT l.id, l.id_affair, a.title, l.event FROM affair_alerts l JOIN affairs a ON a.id = l.id_affair
        WHERE l.id_user = $1::int AND l.pushed_at IS NULL ORDER BY l.created_at`, userId),

    // the readers with an alert that no device was told of yet
    usersWithUnpushed: async () => (await prisma.$queryRawUnsafe('SELECT DISTINCT id_user FROM affair_alerts WHERE pushed_at IS NULL')).map(row => row.id_user),

    // how many times each affair rang this reader since: the alerts sent together share their time, so they are one ring
    ringsSince: async (userId, since) => prisma.$queryRawUnsafe(
        'SELECT id_affair, count(DISTINCT pushed_at)::int AS n FROM affair_alerts WHERE id_user = $1::int AND pushed_at >= $2::timestamptz GROUP BY id_affair', userId, since),

    markPushed: async (ids) => ids.length === 0 ? 0 : prisma.$executeRawUnsafe('UPDATE affair_alerts SET pushed_at = now() WHERE id = ANY($1::int[])', ids),

    // --- the devices ---

    saveSubscription: async ({userId, endpoint, p256dh, auth, userAgent}) => prisma.$executeRawUnsafe(`
        INSERT INTO push_subscriptions (id_user, endpoint, p256dh, auth, user_agent) VALUES ($1::int, $2, $3, $4, $5)
        ON CONFLICT (endpoint) DO UPDATE SET id_user = $1::int, p256dh = $3, auth = $4, user_agent = $5, failures = 0`,
        userId, endpoint, p256dh, auth, userAgent),

    subscriptionsOf: async (userId) => prisma.$queryRawUnsafe(
        'SELECT id, endpoint, p256dh, auth, failures FROM push_subscriptions WHERE id_user = $1::int', userId),

    deleteSubscription: async (userId, endpoint) => prisma.$executeRawUnsafe(
        'DELETE FROM push_subscriptions WHERE id_user = $1::int AND endpoint = $2', userId, endpoint),

    // a push that failed: the device is forgotten once gone for good (a 404 or 410 of its push service), else after
    // 5 failures in a row; one that went resets the count
    pushFailed: async (id, gone) => prisma.$executeRawUnsafe(
        'UPDATE push_subscriptions SET failures = failures + 1 WHERE id = $1::int', id)
        .then(() => gone ? prisma.$executeRawUnsafe('DELETE FROM push_subscriptions WHERE id = $1::int', id)
            : prisma.$executeRawUnsafe('DELETE FROM push_subscriptions WHERE id = $1::int AND failures >= 5', id)),
    pushWorked: async (id) => prisma.$executeRawUnsafe('UPDATE push_subscriptions SET failures = 0 WHERE id = $1::int AND failures > 0', id),
};
