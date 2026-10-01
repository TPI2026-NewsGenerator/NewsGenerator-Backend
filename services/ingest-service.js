//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: ingest-service.js
//  Description: The work done in background every minute: read the feeds due, give the new news
//               their vectors, group them into stories, and the stories into threads
//

"use strict"

import process from 'node:process'
import pg from 'pg';
import {rss} from "../db/rss-links.js";
import {FeedService, RETENTION_DAYS} from "./feed-service.js";
import {FeedModel} from "../models/feed-model.js";
import {StoryModel} from "../models/story-model.js";
import {embed, toSparsevec, toVector} from "./utils/embedder.js";
import {languageOf} from "./utils/language.js";
import {ProfileModel} from "../models/profile-model.js";
import {DirectoryModel} from "../models/directory-model.js";
import {DirectoryService} from "./directory-service.js";
import {googleAvailable, interestSearchUrls, isGoogleNewsUrl, languageOfSearch} from "./utils/google-news.js";

// A user never waits for a feed: the searches and the briefing read what this has already stored.
// A run every minute reads the feeds due by their rhythm (see READ_EVERY), not all the feeds: read all
// every 20 minutes, a news waited 19 minutes in the median to be read, 28 to have its vectors
const INTERVAL_MINUTES = Number(process.env.INGEST_INTERVAL_MINUTES) || 1;
// Minutes between two reads of a feed, by the news it gave in the last 24 hours: read every minute,
// the 1500 feeds made 24 requests a second to sites whose feed changes every few minutes at best (and
// often cached by them as long). The 200 feeds giving 3 news an hour or more are read every 2 minutes;
// a feed of 24 hours without news every hour, a failing one twice less often per failure in a row,
// every hour at most. 220 requests a minute, 77 when every feed was read every 20
const READ_EVERY = [[72, 2], [24, 5], [6, 15], [1, 30], [0, 60]];
const RHYTHM_HOURS = 24;
// the old news dropped and the empty stories deleted this often, the directory grown this often:
// not every minute
const HOUSEKEEPING_MINUTES = 60;
const GROW_EVERY_MINUTES = 20;
export const WINDOW_HOURS = 48;         // news older than this get no vectors and join no story
// News embedded, saved and grouped at a time. On a busy processor 1500 news took over an hour, all
// lost if the process stopped before saving them; grouping costs the same per news in small batches.
// 100: a batch of 300 took 4 to 5 minutes on the processor alone (the graphics card off), the feeds of
// 2 minutes were read every 5 meanwhile; 100 is a run of about 1.5 minutes, the newest news first
const MAX_EMBEDDED_PER_RUN = Number(process.env.INGEST_MAX_EMBEDDED) || 100;
// stories judged for their thread at a time: each news grouped marks its story again, at 100 a call
// the stories waiting would never drain (a call is a fraction of a second)
const THREADED_PER_CALL = 300;
// The news older than the window without vectors (published before the embedder ran, or during a
// stop longer than the window) get theirs too, for the search by meaning, which reads the whole
// retention; they join no story. Once the news of the window all have their vectors and stories and
// while the run has time, and this many batches at most per run: on a processor a batch of 300 is
// 3 to 4 minutes, which took the place of a batch of the window while the graphics card was off
const OLDER_BATCHES_PER_RUN = Number(process.env.INGEST_OLDER_BATCHES) || 1;
// The news of the window are embedded and grouped by batches, the newest first, each batch in one
// transaction of its own (assign_stories, assign_threads): the 12 000 news of the first read of the
// directory, grouped at once, held the lock 2 h 10 with no feed read meanwhile and nothing saved before
// the end. A scheduled run starts no batch once it has worked these minutes (the feeds read included),
// the rest waits for the next run, which reads the feeds due before. A time and not a number of
// batches: a batch of 300 took 4 minutes, then 9 with 31 000 news in the window (each news is compared
// to all the others). Short: the feeds of 2 minutes wait no longer for a backlog, each run takes the
// newest of it
const GROUP_MINUTES = Number(process.env.INGEST_GROUP_MINUTES) || 1;
const DESCRIPTION_CHARS = 400;          // the start of the description read with the title
const STORY_THRESHOLD = 0.70;           // dense + sparse of the titles, see assign_stories (db/add_briefing.sql)
const STORY_SPARSE_WEIGHT = 1;
const STORY_SAME_MEDIUM_MARGIN = 0.5;   // what two titles of one medium need more: its templates look alike
const STORY_TEXT_THRESHOLD = 0.6;       // the texts must meet too: one subject is not one fact
const STORY_IDLE_DECAY = 0.003;         // a story quiet for a while asks more, per hour: it drifts less
const STORY_IDLE_GRACE = 6;             // hours before it starts
// the stories of one affair linked in a thread, see assign_threads (db/add_threads.sql)
const THREAD_THRESHOLD = 0.75;          // a story joining a thread: its average likeness to the stories of other media
const THREAD_SAME_MEDIUM_MARGIN = 0.10; // what it needs more through stories of its own media: their series look alike
const THREAD_MERGE_THRESHOLD = 0.70;    // two threads of one affair born apart become one
const THREAD_ACTIVE_DAYS = 7;           // a thread quiet for longer takes no more story
const LOCK_KEY = 'newsgenerator-ingest';
// The searches of Google News of the interests are read less often than the feeds: each is one more
// request to Google, which blocks an address asking too much. A search gives the news of 2 days, an
// hour late costs nothing
const GOOGLE_EVERY_MINUTES = Number(process.env.GOOGLE_NEWS_EVERY_MINUTES) || 60;
const MAX_GOOGLE_PER_RUN = 60;
export const GOOGLE_ENABLED = () => process.env.GOOGLE_NEWS !== 'off';

// the language of each shared feed, from db/rss-links.js
const sharedLanguage = new Map(Object.entries(rss).flatMap(([language, categories]) =>
    Object.values(categories).flat().map(url => [url, language])));

// what is embedded for the profiles: the title and the start of the description
export const richText = (title, description) => {
    const text = (description ?? '').replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_CHARS);
    return text ? `${title}. ${text}` : title;
};

// the vectors of the news published in the window that have none yet: of every feed, or of these ones.
// 'since' further back for the older news
const embedPending = async (urls = null, since = new Date(Date.now() - WINDOW_HOURS * 3600e3)) => {
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

// the stories grouped since their thread was judged join the threads of their affair
export const threadPending = (maxStories = null) => StoryModel.assignThreads({
    threshold: THREAD_THRESHOLD,
    sameMediumMargin: THREAD_SAME_MEDIUM_MARGIN,
    mergeThreshold: THREAD_MERGE_THRESHOLD,
    activeDays: THREAD_ACTIVE_DAYS,
    maxStories,
});

// the news with vectors and no story join the stories of the window, or start new ones: done in the
// database, where the vectors are (see assign_stories in db/add_briefing.sql)
const groupPending = (maxNews) => StoryModel.assignStories({
    since: new Date(Date.now() - WINDOW_HOURS * 3600e3),
    threshold: STORY_THRESHOLD,
    sparseWeight: STORY_SPARSE_WEIGHT,
    sameMediumMargin: STORY_SAME_MEDIUM_MARGIN,
    textThreshold: STORY_TEXT_THRESHOLD,
    idleDecay: STORY_IDLE_DECAY,
    idleGrace: STORY_IDLE_GRACE,
    maxNews,
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
let lastHousekeeping = 0;

// the minutes until a feed is read again: by its news, GOOGLE_EVERY_MINUTES for a search of Google
export const readEvery = ({url, news, failures}) => {
    const minutes = isGoogleNewsUrl(url) ? GOOGLE_EVERY_MINUTES : READ_EVERY.find(([least]) => news >= least)[1];
    return Math.min(minutes * 2 ** Math.min(failures, 6), Math.max(60, minutes));
};

// the feeds to read now of these rows (FeedModel.feedRhythms): never read, or read longer ago than
// their rhythm
export const feedsDue = (rows, now = Date.now()) => rows
    .filter(row => !row.last_fetched_at || new Date(row.last_fetched_at).getTime() + readEvery(row) * 60e3 <= now)
    .map(row => row.url);

// the searches of Google News of every reader not read for GOOGLE_EVERY_MINUTES
const dueSearches = async () => {
    if (!GOOGLE_ENABLED() || !googleAvailable()) return [];
    const urls = [...new Set((await ProfileModel.searchesOf())
        .flatMap(({searches, languages}) => interestSearchUrls(searches, languages)))];
    return FeedModel.dueFeeds(urls, new Date(Date.now() - GOOGLE_EVERY_MINUTES * 60e3), MAX_GOOGLE_PER_RUN);
};

// the searches of Google News of every reader in this language (every language without one), for
// interests of these categories (or of none): they say which subjects are followed, never by whom,
// and a search reads them
export const searchesOfCategories = async (categories, language = null) => GOOGLE_ENABLED()
    ? [...new Set((await ProfileModel.searchesOf())
        .filter(({category}) => !category || categories.includes(category))
        .flatMap(({searches, languages}) => interestSearchUrls(searches, languages.filter(read => !language || read === language))))]
    : [];

// The feeds of Google News of the sentences searched in this language (every language without one),
// during the retention: Google
// News is asked every sentence (see NewsService.getNews), and its news are read by every search after,
// as the searches of the profiles, never saying who searched. The searches of the profiles are left
// out: searchesOfCategories gives them, of the categories asked
export const sentenceFeeds = async (language = null) => {
    if (!GOOGLE_ENABLED()) return [];
    const [read, profiles] = await Promise.all([
        FeedModel.googleSearchFeeds(new Date(Date.now() - RETENTION_DAYS * 24 * 3600e3)),
        ProfileModel.searchesOf(),
    ]);
    const ofProfiles = new Set(profiles.flatMap(({searches, languages}) => interestSearchUrls(searches, languages)));
    return read.filter(url => !ofProfiles.has(url) && (!language || languageOfSearch(url) === language));
};

// the searches of Google News of one reader, read with the sources just found for them
export const searchesOfUser = async (userId) => GOOGLE_ENABLED()
    ? [...new Set((await ProfileModel.searchesOf(userId)).flatMap(({searches, languages}) => interestSearchUrls(searches, languages)))]
    : [];

export const IngestService = {
    // These feeds read now and their news given vectors, whatever their date and without waiting for
    // the run at work: a search waits for them (the search of Google News of a sentence, see
    // NewsService.getNews). Answers how many news got vectors
    readNow: async (urls) => {
        await FeedService.refreshUrls(urls);
        const since = new Date(Date.now() - RETENTION_DAYS * 24 * 3600e3);
        let embedded = 0;
        for (let batch = await embedPending(urls, since); batch > 0; batch = await embedPending(urls, since)) {
            embedded += batch;
            if (batch < MAX_EMBEDDED_PER_RUN) break;
        }
        return embedded;
    },

    // one pass: the feeds due read (or these ones), the new news embedded and grouped
    run: async ({urls = null} = {}) => {
        const started = Date.now();
        const result = await withLock(async () => {
            let feeds = urls;
            let purge = false;
            if (!urls) {
                const directory = (await DirectoryModel.all()).map(feed => feed.url);
                const every = [...new Set([...sharedLanguage.keys(), ...directory, ...await FeedModel.allUserFeedUrls()])];
                const due = feedsDue(await FeedModel.feedRhythms(every, new Date(Date.now() - RHYTHM_HOURS * 3600e3)));
                feeds = [...new Set([...due, ...await dueSearches()])];
                purge = Date.now() - lastHousekeeping >= HOUSEKEEPING_MINUTES * 60e3;
            }
            const refresh = await FeedService.refreshUrls(feeds, {purge});

            // the embedder may be down: the news are stored anyway, they get their vectors next time
            let embedded = 0;
            let older = 0;
            let grouping = {grouped: 0, created: 0, threaded: 0, merged: 0};
            let lastGrouped = 0;
            const groupingEnds = started + GROUP_MINUTES * 60e3;
            const timeLeft = () => Date.now() < groupingEnds;
            const group = async () => {
                const done = await groupPending(MAX_EMBEDDED_PER_RUN);
                const threads = await threadPending(THREADED_PER_CALL);
                lastGrouped = done.grouped;
                grouping = {
                    grouped: grouping.grouped + done.grouped, created: grouping.created + done.created,
                    threaded: grouping.threaded + threads.touched, merged: grouping.merged + threads.merged,
                };
            };
            try {
                // a backlog (the first run, a long stop) is worked through in several batches, each
                // grouped at once so the briefing can use it without waiting for the others. A run of
                // some feeds (those just found for a profile) embeds all of theirs, and only theirs:
                // a new reader had 300 of 564 and waited the next run for the rest, and the backlog
                // of the others is the work of the scheduled run, for GROUP_MINUTES at a time
                let windowLeft = false;     // news of the window still without vectors or story
                for (let batch = await embedPending(urls); batch > 0; batch = await embedPending(urls)) {
                    embedded += batch;
                    await group();
                    if (batch < MAX_EMBEDDED_PER_RUN) break;
                    if (urls === null && !timeLeft()) {
                        windowLeft = true;
                        break;
                    }
                }
                // news embedded and in no story: by a run that stopped before grouping them, by a search
                // reading Google News, or more than a batch waiting. As long as the run has time
                if (embedded === 0) await group();
                while (lastGrouped === MAX_EMBEDDED_PER_RUN && timeLeft()) await group();
                if (lastGrouped === MAX_EMBEDDED_PER_RUN) windowLeft = true;
                // then the older news, for the search only (the grouping reads the window)
                if (urls === null && !windowLeft && timeLeft()) {
                    const retention = new Date(Date.now() - RETENTION_DAYS * 24 * 3600e3);
                    for (let run = 0; run < OLDER_BATCHES_PER_RUN; run++) {
                        const batch = await embedPending(null, retention);
                        older += batch;
                        if (batch < MAX_EMBEDDED_PER_RUN) break;
                    }
                }
            } catch (err) {
                console.error(`Ingest: vectors not computed (${err.message})`);
            }

            if (purge) {
                await StoryModel.deleteEmptyStories();
                lastHousekeeping = Date.now();
            }
            return {feeds: feeds.length, inserted: refresh?.inserted ?? 0, embedded, older, ...grouping};
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

    // a run now, then every INTERVAL_MINUTES, for as long as the server lives. Every GROW_EVERY_MINUTES,
    // the directory looks at a few more media after the run: the feeds it adds are read by the next
    // one. Each run plans the next one INTERVAL_MINUTES after its own start, or at once when it worked
    // longer: a fixed timer fell 6 s before the end of a run of 20 min on the processor, that tick was
    // skipped and nothing ran for the next 20 minutes
    schedule: () => {
        if (timer) return;
        let lastGrow = 0;
        const grow = async () => {
            if (Date.now() - lastGrow < GROW_EVERY_MINUTES * 60e3) return;
            lastGrow = Date.now();
            const tried = await DirectoryService.grow();
            const kept = tried.flatMap(medium => medium.kept);
            if (tried.length > 0) console.log(`Directory: ${tried.length} media looked at, ${kept.length} feeds added (${kept.map(feed => feed.url).join(', ') || 'none'})`);
        };
        const tick = () => {
            const started = Date.now();
            IngestService.run()
                .then(grow)
                .catch(err => console.error(`Ingest failed: ${err.stack ?? err}`))
                .finally(() => {
                    timer = setTimeout(tick, Math.max(0, started + INTERVAL_MINUTES * 60e3 - Date.now()));
                    timer.unref?.();
                });
        };
        timer = true;   // scheduled: a second call does nothing
        tick();
    },
};
