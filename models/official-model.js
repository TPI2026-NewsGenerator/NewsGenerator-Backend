//
//  Author: Fabian Rostello
//  Date: 12.10.2026
//  File: official-model.js
//  Description: What the official source of a card is looked for with: the Wikidata item of each name
//               of a party, the channels of the items, and the news of their websites our feeds
//               already read (db/add_official_sources.sql)
//

"use strict"

import {prisma} from '../config/db.js';

const NAMES_DAYS = 7;           // a name without an item is searched again after it
const CHANNELS_DAYS = 30;
const SITE_FEED_DAYS = 7;
const NEWS_PER_MEDIUM = 300;

export const OfficialModel = {
    // {name|what -> qid}: the names searched less than NAMES_DAYS ago, qid null when none was found
    names: async (parties) => {
        if (parties.length === 0) return new Map();
        const rows = await prisma.$queryRawUnsafe(`
            SELECT p.name, p.what, p.qid FROM party_names p
            JOIN jsonb_to_recordset($1::jsonb) AS asked(name text, what text) USING (name, what)
            WHERE p.qid IS NOT NULL OR p.checked_at > now() - make_interval(days => ${NAMES_DAYS})`,
            JSON.stringify(parties.map(({name, what}) => ({name, what}))));
        return new Map(rows.map(row => [`${row.name}|${row.what}`, row.qid]));
    },

    // [{name, what, qid}], qid null when none was found
    saveNames: async (rows) => rows.length === 0 ? 0 : prisma.$executeRawUnsafe(`
        INSERT INTO party_names (name, what, qid, checked_at)
        SELECT name, what, qid, now() FROM jsonb_to_recordset($1::jsonb) AS r(name text, what text, qid text)
        ON CONFLICT (name, what) DO UPDATE SET qid = EXCLUDED.qid, checked_at = now()`, JSON.stringify(rows)),

    // [{qid, label, channels, fresh, site_feed, site_feed_fresh}] of the items known
    items: async (qids) => qids.length === 0 ? [] : prisma.$queryRawUnsafe(`
        SELECT qid, label, channels, channels_at > now() - make_interval(days => ${CHANNELS_DAYS}) AS fresh,
               site_feed, site_feed_at > now() - make_interval(days => ${SITE_FEED_DAYS}) AS site_feed_fresh
        FROM entities WHERE qid = ANY($1::text[])`, qids),

    // [{qid, label, description, channels}] read from Wikidata: an item new to us gets a row of its
    // own, its label alone for its names, as a linked item does (see EntityModel.save)
    saveChannels: async (items) => items.length === 0 ? 0 : prisma.$executeRawUnsafe(`
        INSERT INTO entities (qid, label, description, names, channels, channels_at)
        SELECT i.qid, i.label, i.description, ARRAY[i.label], i.channels, now()
        FROM jsonb_to_recordset($1::jsonb) AS i(qid text, label text, description text, channels jsonb)
        ON CONFLICT (qid) DO UPDATE SET channels = EXCLUDED.channels, channels_at = now()`, JSON.stringify(items)),

    // the feed of the website of an item, '' when it has none
    saveSiteFeed: async (qid, url) => prisma.$executeRawUnsafe(`
        UPDATE entities SET site_feed = $2, site_feed_at = now() WHERE qid = $1`, qid, url),

    // [{medium, title, description, url, at}]: the news of these media since then, of any feed (the
    // ones of Google News name the medium they are of), NEWS_PER_MEDIUM newest of each
    newsOfMedia: async (media, since) => media.length === 0 ? [] : prisma.$queryRawUnsafe(`
        SELECT medium, title, description, url, at FROM (
            SELECT a.medium, a.title, a.description, COALESCE(a.resolved_link, a.link) AS url,
                   COALESCE(a.published_at, a.created_at) AS at,
                   row_number() OVER (PARTITION BY a.medium ORDER BY COALESCE(a.published_at, a.created_at) DESC) AS place
            FROM articles a
            WHERE a.medium = ANY($1::text[]) AND a.created_at >= $2::timestamptz
        ) news
        WHERE place <= ${NEWS_PER_MEDIUM}`, media, since),
};
