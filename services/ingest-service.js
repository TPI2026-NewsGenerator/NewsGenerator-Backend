//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: ingest-service.js
//  Description: The work done in background every few minutes: read every feed, give the new news
//               their vectors, group them into stories
//

"use strict"

import process from 'node:process'
import pg from 'pg';
import {rss} from "../db/rss-links.js";
import {FeedService} from "./feed-service.js";
import {FeedModel} from "../models/feed-model.js";
import {StoryModel} from "../models/story-model.js";
import {embed, toSparsevec, toVector} from "./utils/embedder.js";
import {languageOf} from "./utils/language.js";
import {ProfileModel} from "../models/profile-model.js";
import {googleAvailable, interestSearchUrls, languageOfSearch} from "./utils/google-news.js";

// A user never waits for a feed: the searches and the briefing read what this has already stored.
const INTERVAL_MINUTES = Number(process.env.INGEST_INTERVAL_MINUTES) || 20;
export const WINDOW_HOURS = 48;         // news older than this get no vectors and join no story
// News embedded, saved and grouped at a time. On a busy processor 1500 news took over an hour, all
// lost if the process stopped before saving them; grouping costs the same per news in small batches
const MAX_EMBEDDED_PER_RUN = Number(process.env.INGEST_MAX_EMBEDDED) || 300;
const DESCRIPTION_CHARS = 400;          // the start of the description read with the title
const STORY_THRESHOLD = 0.70;           // dense + sparse of the titles, see assign_stories (db/add_briefing.sql)
const STORY_SPARSE_WEIGHT = 1;
const STORY_SAME_MEDIUM_MARGIN = 0.5;   // what two titles of one medium need more: its templates look alike
const STORY_TEXT_THRESHOLD = 0.6;       // the texts must meet too: one subject is not one fact
const LOCK_KEY = 'newsgenerator-ingest';
// The searches of Google News of the interests are read less often than the feeds: each is one more
// request to Google, which blocks an address asking too much. A search gives the news of 2 days, an
// hour late costs nothing
const GOOGLE_EVERY_MINUTES = Number(process.env.GOOGLE_NEWS_EVERY_MINUTES) || 60;
const MAX_GOOGLE_PER_RUN = 60;
const GOOGLE_ENABLED = () => process.env.GOOGLE_NEWS !== 'off';

// the language of each shared feed, from db/rss-links.js
const sharedLanguage = new Map(Object.entries(rss).flatMap(([language, categories]) =>
    Object.values(categories).flat().map(url => [url, language])));

// what is embedded for the profiles: the title and the start of the description
export const richText = (title, description) => {
    const text = (description ?? '').replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_CHARS);
    return text ? `${title}. ${text}` : title;
};

// the vectors of the news published in the window that have none yet: of every feed, or of these ones
const embedPending = async (urls = null) => {
    const since = new Date(Date.now() - WINDOW_HOURS * 3600e3);
    const pending = await StoryModel.pendingArticles(since, MAX_EMBEDDED_PER_RUN, urls);
    if (pending.length === 0) return 0;

    // a news in several feeds, or a title republished, is encoded once
    const texts = [...new Set(pending.flatMap(a => [a.title, richText(a.title, a.description)]))];
    const vectors = new Map((await embed(texts)).map((vector, i) => [texts[i], vector]));

    await StoryModel.saveVectors(pending.map(a => {
        const title = vectors.get(a.title);
        const text = vectors.get(richText(a.title, a.description));
        const fallback = a.feed_language ?? sharedLanguage.get(a.feed) ?? languageOfSearch(a.feed) ?? null;
        return {
            id: a.id,
            lang: languageOf(`${a.title} ${a.description ?? ''}`, fallback) ?? 'en',
            titleDense: toVector(title.dense),
            titleSparse: toSparsevec(title.sparse),
            textDense: toVector(text.dense),
            textSparse: toSparsevec(text.sparse),
        };
    }));

    return pending.length;
};

// the news with vectors and no story join the stories of the window, or start new ones: done in the
// database, where the vectors are (see assign_stories in db/add_briefing.sql)
const groupPending = () => StoryModel.assignStories({
    since: new Date(Date.now() - WINDOW_HOURS * 3600e3),
    threshold: STORY_THRESHOLD,
    sparseWeight: STORY_SPARSE_WEIGHT,
    sameMediumMargin: STORY_SAME_MEDIUM_MARGIN,
    textThreshold: STORY_TEXT_THRESHOLD,
});

// Two runs must never overlap: the server runs one every few minutes and "pnpm run ingest" can run
// one by hand. A lock of Postgres, held by a connection of its own, says which one works.
const withLock = async (task) => {
    const client = new pg.Client({connectionString: process.env.DATABASE_URL});
    // the connection sits idle while the run works: if Postgres restarts meanwhile, pg says it with
    // an 'error' event, which unheard stops the whole server. The lock went with the connection,
    // the run finishes anyway (its writes fail on their own if the database is still down)
    client.on('error', err => console.error(`Ingest: the connection holding the lock was lost (${err.message})`));
    await client.connect();
    try {
        const {rows: [{locked}]} = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [LOCK_KEY]);
        if (!locked) return null;
        try {
            return await task();
        } finally {
            // a lost connection took the lock with it: nothing left to give back
            await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]).catch(() => {});
        }
    } finally {
        await client.end();
    }
};

let timer = null;

// the searches of Google News of every reader not read for GOOGLE_EVERY_MINUTES
const dueSearches = async () => {
    if (!GOOGLE_ENABLED() || !googleAvailable()) return [];
    const urls = [...new Set((await ProfileModel.searchesOf())
        .flatMap(({searches, languages}) => interestSearchUrls(searches, languages)))];
    return FeedModel.dueFeeds(urls, new Date(Date.now() - GOOGLE_EVERY_MINUTES * 60e3), MAX_GOOGLE_PER_RUN);
};

// the searches of Google News of one reader, read with the sources just found for them
export const searchesOfUser = async (userId) => GOOGLE_ENABLED()
    ? [...new Set((await ProfileModel.searchesOf(userId)).flatMap(({searches, languages}) => interestSearchUrls(searches, languages)))]
    : [];

export const IngestService = {
    // one pass: every feed read (or only these ones), the new news embedded and grouped
    run: async ({urls = null} = {}) => {
        const started = Date.now();
        const result = await withLock(async () => {
            const feeds = urls ?? [...new Set([...sharedLanguage.keys(), ...await FeedModel.allUserFeedUrls(), ...await dueSearches()])];
            const refresh = await FeedService.refreshUrls(feeds, {purge: urls === null});

            // the embedder may be down: the news are stored anyway, they get their vectors next time
            let embedded = 0;
            let grouping = {grouped: 0, created: 0};
            const group = async () => {
                const done = await groupPending();
                grouping = {grouped: grouping.grouped + done.grouped, created: grouping.created + done.created};
            };
            try {
                // a backlog (the first run, a long stop) is worked through in several batches, each
                // grouped at once so the briefing can use it without waiting for the others. A run of
                // some feeds (those just found for a profile) embeds all of theirs, and only theirs:
                // a new reader had 300 of 564 and waited the next run for the rest, and the backlog
                // of the others is the work of the scheduled run
                for (let batch = await embedPending(urls); batch > 0; batch = await embedPending(urls)) {
                    embedded += batch;
                    await group();
                    if (batch < MAX_EMBEDDED_PER_RUN) break;
                }
                // news embedded by a run that stopped before grouping them
                if (embedded === 0) await group();
            } catch (err) {
                console.error(`Ingest: vectors not computed (${err.message})`);
            }

            if (urls === null) await StoryModel.deleteEmptyStories();
            return {feeds: feeds.length, inserted: refresh?.inserted ?? 0, embedded, ...grouping};
        });

        if (result === null) {
            // a run is already working (the first one can take most of an hour): the feeds asked for
            // (those just found for a profile) are read anyway, the run at work gives them their
            // vectors, it takes the news still without them batch after batch
            if (urls) {
                const refresh = await FeedService.refreshUrls(urls, {purge: false});
                console.log(`Ingest: another run is working, ${urls.length} feeds read, their news embedded by it`);
                return {feeds: urls.length, inserted: refresh?.inserted ?? 0, embedded: 0, grouped: 0, created: 0};
            }
            console.log('Ingest: another run is working, skipped');
            return null;
        }
        console.log(`Ingest: ${JSON.stringify({...result, seconds: Math.round((Date.now() - started) / 1000)})}`);
        return result;
    },

    // a run now, then every INTERVAL_MINUTES, for as long as the server lives
    schedule: () => {
        if (timer) return;
        const tick = () => IngestService.run().catch(err => console.error(`Ingest failed: ${err.stack ?? err}`));
        tick();
        timer = setInterval(tick, INTERVAL_MINUTES * 60 * 1000);
        timer.unref?.();
    },
};
