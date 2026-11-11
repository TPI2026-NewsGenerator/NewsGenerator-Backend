//
//  Author: Fabian Rostello
//  Date: 04.11.2026
//  File: affair-service.js
//  Description: The affair of a card of a briefing: which cards are one (the chip under them), and for one card its
//               events in time order and how widely the media talked of it
//

"use strict"

import process from 'node:process';
import {AffairModel} from '../models/affair-model.js';
import {BriefingModel} from '../models/briefing-model.js';
import {ProfileModel} from '../models/profile-model.js';
import {feedsOf} from './briefing-service.js';
import {PushService} from './push-service.js';
import {affairFile, buildAffair, translateEvents} from './utils/affair.js';
import {withShownMarks} from './utils/affair-marks.js';
import {watchAffair} from './utils/affair-watch.js';
import {mapWithConcurrency} from './utils/concurrency.js';
import {readerLanguage} from './utils/language.js';
import {memo} from './utils/memo.js';
import {newUsage} from './utils/ollama.js';

// A card is looked at as an affair when its thread (the news of one affair the grouping put together, in one
// language) holds this many stories told by this many media. Of the 706 cards of the last 40 briefings
// (4.11.2026) 217 had a thread of three stories or more: the AI says which of them are one affair (a series of
// matches is not), and is asked only for these
export const MIN_STORIES = 3;
export const MIN_MEDIA = 3;
const MAX_CHIPS = 25;
const AI_CONCURRENCY = 3;

// A reader follows this many affairs at most: each is checked every quarter of an hour and costs a few calls of the AI
// when something new comes
const MAX_FOLLOWED = 20;
// the affairs followed are checked this often: the stories created since the last check are the ones judged, so a check
// costs the same whatever the pause. A quarter of an hour is the pace of the ingestion
const WATCH_MINUTES = Number(process.env.AFFAIR_WATCH_MINUTES) || 15;
const FIRST_WATCH_MS = 3 * 60e3;
const WATCH_CONCURRENCY = 2;
let watching = false;
let scheduled = false;

// An affair is built once: the month of stories compared is a few seconds of the database and the judgment a
// few calls of the AI. Kept by card and language, the same for every reader of the card, a while; two requests
// for one card at once wait for the same build
const files = memo({ttlMs: 24 * 3600e3, max: 1000});
const views = memo({ttlMs: 3 * 3600e3, max: 200});
const building = new Map();

const once = (key, build) => {
    if (!building.has(key)) building.set(key, build().finally(() => building.delete(key)));
    return building.get(key);
};

// {row, item, profile, language, feedUrls, title} of a card of a ready briefing of this reader, else 404
const cardOf = async (userId, briefingId, storyId) => {
    const id = Number(briefingId);
    const row = Number.isInteger(id) && id > 0 ? await BriefingModel.ofUser(userId, id) : null;
    if (!row || row.status !== 'ready') throw Object.assign(new Error('Unknown briefing.'), {status: 404});
    const item = (row.items ?? []).find(card => card.storyId === Number(storyId));
    if (!item) throw Object.assign(new Error('Unknown card.'), {status: 404});
    const profile = row.id_profile ? await ProfileModel.get(row.id_profile) : null;
    return {row, item, language: readerLanguage(profile ?? {}), profileId: row.id_profile, title: item.titleTranslation ?? item.title};
};

// the file of the affair of a card, made once (null: no affair)
const fileOf = (card, feedUrls) => once(`file ${card.item.storyId}:${card.language}`, async () => {
    const key = `${card.item.storyId}:${card.language}`;
    if (files.get(key) !== undefined) return files.get(key);
    const usage = newUsage();
    const file = await affairFile({storyId: card.item.storyId, title: card.title, language: card.language, feedUrls, usage});
    files.set(key, file);
    console.log(`Affair ${card.item.storyId}: ${file ? `"${file.title}"${file.written ? '' : ` (the AI proposed "${file.proposed}")`}` : 'no affair'}, tokens ${JSON.stringify(usage)}`);
    return file;
});

// builds the affairs of these cards in background, in turn: one build is a month of stories compared and 5 to 9 calls
const warm = (userId, briefingId, storyIds) => {
    (async () => {
        for (const storyId of storyIds) {
            await AffairService.view(userId, briefingId, storyId).catch(err => console.error(`Affair ${storyId}: not built in advance (${err.message})`));
        }
    })();
};

export const AffairService = {
    // The cards of a briefing that are an affair, with its name: {storyId: {title, stories, media, followed}}, followed the id of the
    // affair when the reader follows it already, else null. A card is
    // looked at when its thread is big enough (MIN_STORIES, MIN_MEDIA), the AI then says whether it is one affair.
    // A card the AI fails on is left out, asked again at the next request
    chips: async (userId, briefingId) => {
        const id = Number(briefingId);
        const row = Number.isInteger(id) && id > 0 ? await BriefingModel.ofUser(userId, id) : null;
        if (!row || row.status !== 'ready') throw Object.assign(new Error('Unknown briefing.'), {status: 404});
        const items = (row.items ?? []).filter(card => Number.isInteger(card.storyId) && card.storyId > 0);
        const stats = new Map((await AffairModel.threadStats(items.map(card => card.storyId))).map(one => [one.id, one]));
        const big = items.filter(card => stats.get(card.storyId)?.stories >= MIN_STORIES && stats.get(card.storyId)?.media >= MIN_MEDIA).slice(0, MAX_CHIPS);
        if (big.length === 0) return {};
        const profile = row.id_profile ? await ProfileModel.get(row.id_profile) : null;
        const language = readerLanguage(profile ?? {});
        const feedUrls = await feedsOf(row.id_profile);
        const results = await mapWithConcurrency(big, AI_CONCURRENCY, card =>
            fileOf({item: card, language, title: card.titleTranslation ?? card.title}, feedUrls));
        const failed = results.filter(result => result.status !== 'fulfilled');
        if (failed.length > 0) console.error(`Affair: ${failed.length} cards were not judged (${failed[0].reason?.message})`);
        // the affairs followed come from tables db/add_affairs.sql makes: the names of the affairs show without them
        const followed = await AffairModel.followedStories(userId).catch(() => []);
        const chips = Object.fromEntries(big.flatMap((card, i) => results[i].status === 'fulfilled' && results[i].value
            ? [[card.storyId, {title: results[i].value.title, stories: stats.get(card.storyId).stories, media: stats.get(card.storyId).media,
                followed: followed.find(one => one.anchor_story === card.storyId || one.story_ids.includes(card.storyId))?.id ?? null}]] : []));
        // the affairs are built meanwhile, one after the other: opening one is then instant (a minute of the AI for
        // 25 cards, never awaited, a failure is asked again when the reader opens it)
        warm(userId, id, Object.keys(chips).map(Number));
        return chips;
    },

    // The affair of a card: {affair: false}, or {affair: true, storyId, title, about, events, coverage, builtAt}
    // (see buildAffair). Built on the first request and kept for 30 minutes
    view: async (userId, briefingId, storyId) => {
        const card = await cardOf(userId, briefingId, storyId);
        const key = `${card.item.storyId}:${card.language}`;
        const kept = views.get(key);
        if (kept) return kept;
        return once(`view ${key}`, async () => {
            const feedUrls = await feedsOf(card.profileId);
            const file = await fileOf(card, feedUrls);
            const usage = newUsage();
            const started = Date.now();
            const affair = await buildAffair({storyId: card.item.storyId, title: card.title, language: card.language, feedUrls, file, usage});
            const view = affair.affair ? {...affair, storyId: card.item.storyId, builtAt: new Date().toISOString()} : {affair: false};
            console.log(`Affair ${card.item.storyId}: ${affair.affair ? `${affair.events.length} events, ${affair.coverage.media} media` : 'no affair'} in ${Math.round((Date.now() - started) / 1000)} s, tokens ${JSON.stringify(usage)}`);
            views.set(key, view);
            return view;
        });
    },

    // The affair of a card as the page reads it: the three marks of its events are the ones the AI read in their news (see withShownMarks). The
    // affair kept to be followed (see follow) stays the one view gives, with what the watch counts on
    shownView: async (userId, briefingId, storyId) => {
        const view = await AffairService.view(userId, briefingId, storyId);
        return view.affair ? {...view, events: withShownMarks(view.events)} : view;
    },

    // The affair of a card for the e-mail (see withAffairs): its title, its events, its coverage and the size of its thread ({stories, media},
    // null when the database does not tell), null when the card is no affair. Built by the AI the first time, as view does
    forMail: async (userId, briefingId, storyId) => {
        const view = await AffairService.view(userId, briefingId, storyId);
        if (!view.affair) return null;
        const [stats] = await AffairModel.threadStats([Number(storyId)]).catch(() => []);
        return {title: view.title, events: withShownMarks(view.events), coverage: view.coverage, chip: stats ? {stories: Number(stats.stories), media: Number(stats.media)} : null};
    },

    // --- the affairs a reader follows ---

    // The reader follows the affair behind a card: the affair as the page shows it is kept (its events stay as long as it
    // is followed, the news of them are purged after 30 days) and watched from then on (see watch). Every event it has is
    // known: only what comes after rings. Answers {id, already}: already when a card of an affair followed was asked again
    follow: async (userId, briefingId, storyId) => {
        const card = await cardOf(userId, briefingId, storyId);
        const view = await AffairService.view(userId, briefingId, storyId);
        if (!view.affair) throw Object.assign(new Error('The AI found no single affair behind this card.'), {status: 409});
        const storyIds = [...new Set(view.events.flatMap(event => event.storyIds))];
        const already = await AffairModel.followedHolding(userId, [card.item.storyId, ...storyIds]);
        if (already) return {id: already, already: true};
        if (await AffairModel.countFollowed(userId) >= MAX_FOLLOWED) {
            throw Object.assign(new Error(`You follow ${MAX_FOLLOWED} affairs already: stop following one first.`), {status: 400});
        }
        const events = view.events.map(event => ({...event, asked: true, alerted: false}));
        const newest = events.reduce((best, event) => event.at > best ? event.at : best, events[0].at);
        const id = await AffairModel.follow({
            userId, profileId: card.profileId, title: view.title, language: card.language, about: view.about ?? '', notAbout: view.not ?? '',
            anchorStory: card.item.storyId, storyIds, at: newest, checkedAt: view.builtAt,
            view: {title: view.title, events, coverage: view.coverage, builtAt: view.builtAt, countedAt: view.builtAt},
        });
        console.log(`Affair ${id}: "${view.title}" followed by the user ${userId}, ${events.length} events known`);
        return {id, already: false};
    },

    // the affairs of a reader, the one with the latest event first: [{id, title, followedAt, lastEventAt, events, key, media,
    // unread}], and how many alerts they have not read in all
    list: async (userId) => {
        const rows = await AffairModel.followedBy(userId);
        return {
            affairs: rows.map(row => ({
                id: row.id, title: row.title, followedAt: row.created_at, lastEventAt: row.last_event_at, unread: row.unread,
                events: row.view.events.length, key: row.view.events.filter(event => event.kind === 'key').length, media: row.view.coverage?.media ?? 0,
                last: [...row.view.events].sort((a, b) => b.at.localeCompare(a.at))[0] ?? null,
            })),
            unread: rows.reduce((sum, row) => sum + row.unread, 0),
        };
    },

    // one affair followed: its events, its coverage and the alerts it gave, 404 when it is not this reader's
    detail: async (userId, id) => {
        const row = await AffairModel.followedOne(userId, Number(id));
        if (!row) throw Object.assign(new Error('Unknown affair.'), {status: 404});
        // The titles of the events in the language of the reader: the ones of an affair followed before 5.11.2026 were not read from their
        // letters (a Persian paper of an English feed was left untranslated). Asked once for each event, then kept
        const was = row.view.events.map(event => `${event.language}|${event.titleTranslation ?? ''}`);
        await translateEvents(row.view.events, row.language).catch(err => console.error(`Affair ${row.id}: the titles were not translated (${err.message})`));
        if (row.view.events.some((event, i) => `${event.language}|${event.titleTranslation ?? ''}` !== was[i] || event.translationChecked === undefined)) {
            await AffairModel.saveView(row.id, row.view).catch(() => {});
        }
        const alerts = await AffairModel.alertsOf(row.id);
        return {
            id: row.id, title: row.title, language: row.language, followedAt: row.created_at, checkedAt: row.checked_at, lastEventAt: row.last_event_at,
            events: withShownMarks(row.view.events), coverage: row.view.coverage,
            alerts: alerts.map(alert => ({id: alert.id, at: alert.created_at, read: alert.read_at !== null, event: withShownMarks([alert.event])[0]})),
        };
    },

    // the reader opened it: what it gave is read
    seen: async (userId, id) => {
        if (await AffairModel.markSeen(userId, Number(id)) === 0) throw Object.assign(new Error('Unknown affair.'), {status: 404});
    },

    unfollow: async (userId, id) => {
        if (await AffairModel.unfollow(userId, Number(id)) === 0) throw Object.assign(new Error('Unknown affair.'), {status: 404});
    },

    // how many alerts the reader has not read: the badge of the page
    unread: (userId) => AffairModel.unreadOf(userId),

    // --- the watch ---

    // Every affair followed is checked for what was created since its last check (see watchAffair), then the readers with
    // alerts not yet sent are told on their devices. One run at a time; an affair failing leaves the others, and is
    // checked from where it was at the next run. Answers {checked, alerts}
    watch: async ({now = new Date()} = {}) => {
        if (watching) return {checked: 0, alerts: 0, skipped: true};
        watching = true;
        try {
            const affairs = await AffairModel.followedAll();
            const feeds = new Map();
            const feedsFor = (affair) => {
                const key = affair.id_profile ?? `user ${affair.id_user}`;
                if (!feeds.has(key)) feeds.set(key, (async () => feedsOf(affair.id_profile ?? (await ProfileModel.idsOf(affair.id_user))[0]))());
                return feeds.get(key);
            };
            const results = await mapWithConcurrency(affairs, WATCH_CONCURRENCY, async (affair) => {
                const usage = newUsage();
                const started = Date.now();
                const result = await watchAffair(affair, {feedUrls: await feedsFor(affair), now, usage});
                if (result.accepted > 0 || result.alerts.length > 0) {
                    console.log(`Affair ${affair.id} "${affair.title}": ${result.accepted} stories in, ${result.alerts.length} alerts, ${Math.round((Date.now() - started) / 1000)} s, tokens ${JSON.stringify(usage)}`);
                }
                return result;
            });
            const failed = results.map((result, i) => ({result, affair: affairs[i]})).filter(({result}) => result.status !== 'fulfilled');
            for (const {result, affair} of failed) console.error(`Affair ${affair.id} "${affair.title}": not checked (${result.reason?.message})`);
            const told = new Set(results.flatMap((result, i) => result.status === 'fulfilled' && result.value.alerts.length > 0 ? [affairs[i].id_user] : []));
            // the alerts not sent before (a push that failed is sent again) go to the devices of their reader
            for (const userId of new Set([...told, ...await AffairModel.usersWithUnpushed()])) {
                await PushService.notifyUser(userId).catch(err => console.error(`Push: the user ${userId} was not told (${err.message})`));
            }
            return {checked: affairs.length - failed.length, alerts: results.reduce((sum, result) => sum + (result.status === 'fulfilled' ? result.value.alerts.length : 0), 0)};
        } finally {
            watching = false;
        }
    },

    // checked every WATCH_MINUTES while the server runs, the first time soon after it starts. The server that reads the
    // news only (see INGEST_IN_SERVER): its stories are the ones compared
    schedule: () => {
        if (scheduled) return;
        scheduled = true;
        let said = false;
        const run = () => AffairService.watch().catch(err => {
            // the tables are made by db/add_affairs.sql: said once, not every quarter of an hour, until it is run
            if (/relation "affairs" does not exist|affair_alerts/.test(err.message)) {
                if (!said) console.error('Affair: the watch waits for db/add_affairs.sql to be run');
                said = true;
                return;
            }
            console.error(`Affair: the watch failed (${err.message})`);
        });
        setTimeout(run, FIRST_WATCH_MS).unref();
        setInterval(run, WATCH_MINUTES * 60e3).unref();
    },
};
