//
//  Author: Fabian Rostello
//  Date: 04.11.2026
//  File: affair-watch.js
//  Description: What a followed affair gets since it was last checked: the stories created since that belong to it
//               (judged by the AI against its file), the events they make or add to, and which of those are worth
//               ringing a phone for. Nothing is shown to the reader that the second opinion did not let through
//

"use strict"

import {AffairModel} from '../../models/affair-model.js';
import {StoryModel} from '../../models/story-model.js';
import {AFFAIR_DAYS} from './affair-names.js';
import {CLOSE_LIKENESS, storiesWithNews} from './affair.js';
import {confirmEvents, FACTS_SHOWN, JUDGED_AT_ONCE, judgeStories, sameFactEvents} from './affair-judge.js';
import {eventsOf, mergedNew, refreshedEvent} from './affair-events.js';
import {coverageOf, mergedCoverage} from './affair-coverage.js';
import {mapWithConcurrency} from './concurrency.js';
import {translateTexts} from './extract.js';
import {writtenIn} from './language.js';
import {newUsage} from './ollama.js';

// The stories created since the last check that are close to the affair or in its threads: a quarter of an hour of
// stories is a few thousand, those close to one affair a few dozen, and the AI reads them in one call or two
const MAX_FRESH = 120;
const DAY_MS = 24 * 3600e3;
// the events of the last days are counted again each check: a medium that tells it makes a key event of a minor one
const RECENT_DAYS = 3;
// the coverage is counted again at least this often, with nothing new
const STALE_MS = 3 * 3600e3;
const AI_CONCURRENCY = 2;

// What the check of one affair does with the stories loaded for it, the AI asked here and nothing else read or
// written by the caller (the benches replay it day by day, see bench/affairs/replay.mjs).
//  affair: {title, language, about, not_about, view: {events, coverage}}
//  fresh: the stories created since the last check (see storiesWithNews), none of the affair's
//  held: Map story id -> story, the stories of its events still held, for the counts of the last days and the coverage
//  now: the date of the check
// Answers {events, coverage, alerts, accepted, stored}: events all of the affair's, alerts the events to tell the reader
// (a key event, new or grown into one, the second opinion says to tell), accepted how many fresh stories belong to it
export const checkAffair = async ({affair, fresh, held = new Map(), now = new Date(), usage = newUsage()}) => {
    const language = affair.language;
    const file = {title: affair.title, about: affair.about, not: affair.not_about};
    const known = affair.view.events ?? [];
    const latest = [...known].sort((a, b) => a.at.localeCompare(b.at)).slice(-FACTS_SHOWN)
        .map(event => ({title: event.titleTranslation ?? event.title, at: new Date(event.at)}));

    // 1. the fresh stories judged against the file, oldest first, as the affair itself is built (see buildAffair)
    const ordered = [...fresh].sort((a, b) => a.at - b.at || a.storyId - b.storyId);
    const chunks = Array.from({length: Math.ceil(ordered.length / JUDGED_AT_ONCE)}, (_, i) => ordered.slice(i * JUDGED_AT_ONCE, (i + 1) * JUDGED_AT_ONCE));
    const verdicts = await mapWithConcurrency(chunks, AI_CONCURRENCY, chunk =>
        judgeStories(file, latest, chunk.map(story => ({title: story.news[0].title, at: story.at, lang: story.lang})), usage));
    const failed = verdicts.find(result => result.status !== 'fulfilled');
    if (failed) throw failed.reason;
    const judged = chunks.flatMap((chunk, c) => chunk.map((story, i) => {
        const verdict = verdicts[c].value[i];
        return {story, verdict, at: story.at, asStory: verdict.as === null ? null : chunk[verdict.as].storyId};
    })).filter(item => item.verdict.in);

    // 2. their events, the titles in the language of the reader
    const pairs = [...new Set(judged.flatMap(item => item.asStory === null ? [] : [item.story.storyId, item.asStory]))];
    const likeness = new Map((pairs.length < 2 ? [] : await StoryModel.likenessAmong(pairs).catch(() => [])).map(row => [`${row.a}:${row.b}`, row.likeness]));
    const found = eventsOf(judged, {language, likeness: (a, b) => likeness.get(`${Math.min(a, b)}:${Math.max(a, b)}`) ?? 0});
    const foreign = found.filter(event => event.language !== language && writtenIn(event.language) && writtenIn(language));
    const translations = foreign.length === 0 ? [] : await translateTexts(foreign.map(event => ({text: event.title, from: writtenIn(event.language)})), writtenIn(language), usage)
        .catch(() => foreign.map(() => null));
    for (const event of found) event.titleTranslation = translations[foreign.indexOf(event)] ?? null;

    // 3. the ones that tell a fact the reader has are added to it, the others come after
    const near = known.filter(event => found.some(one => Math.abs(+new Date(one.at) - +new Date(event.at)) <= RECENT_DAYS * DAY_MS));
    const groups = found.length === 0 ? [] : await sameFactEvents(file, [...near, ...found], usage).catch(() => []);
    const merged = mergedNew(near, found, groups, language);
    const nearIds = new Set(near.map(event => event.id));
    let events = [...known.filter(event => !nearIds.has(event.id)), ...merged.events].sort((a, b) => a.at.localeCompare(b.at));

    // 4. the events of the last days counted again: a second medium makes a key event of a minor one
    const before = new Map(known.map(event => [event.id, event.kind]));
    const recentAt = +now - RECENT_DAYS * DAY_MS;
    events = events.map(event => +new Date(event.at) >= recentAt ? refreshedEvent(event, held) : event);

    // 5. a key event the reader was not told of is read once more: only a new fact that changes where the affair stands rings
    const candidates = events.filter(event => event.kind === 'key' && !event.asked);
    // what the reader knows: the latest facts, and what rang in the last two weeks (a candidate told is not told again)
    const rungBefore = events.filter(event => event.alerted && +new Date(event.at) >= +now - 14 * DAY_MS && !latest.some(fact => fact.title === (event.titleTranslation ?? event.title)))
        .map(event => ({title: event.titleTranslation ?? event.title, at: new Date(event.at)}));
    const rings = candidates.length === 0 ? [] : await confirmEvents(file, [...rungBefore, ...latest], candidates, usage)
        .catch(err => {
            console.error(`Affair "${affair.title}": the second opinion failed, asked again at the next check (${err.message})`);
            return null;
        });
    // the opinion failing leaves the events unasked: they are asked again, nothing rings for an answer not had
    const asked = new Set(rings === null ? [] : candidates.map(event => event.id));
    const rung = new Set(rings === null ? [] : candidates.filter((_, i) => rings[i]).map(event => event.id));
    events = events.map(event => asked.has(event.id) ? {...event, asked: true, alerted: rung.has(event.id)} : event);
    const alerts = events.filter(event => rung.has(event.id));

    // 6. the coverage over the news held now, joined to the one kept for the days we no longer hold
    const counted = [...held.values(), ...judged.map(item => item.story)];
    const coverage = counted.length === 0 ? affair.view.coverage : mergedCoverage(affair.view.coverage, coverageOf(counted, now));

    return {
        events, coverage, alerts, accepted: judged.length, promoted: events.filter(event => before.get(event.id) === 'minor' && event.kind === 'key').length,
        stored: [...new Set(events.flatMap(event => event.storyIds))],
    };
};

// The check of one followed affair: the new stories read from the database, the affair counted again, what it
// found saved. affair: a row of AffairModel.followedAll. Answers {alerts, accepted} and saves nothing when the AI fails
export const watchAffair = async (affair, {feedUrls, now = new Date(), usage = newUsage()}) => {
    const since = new Date(affair.checked_at);
    const known = affair.view.events ?? [];
    const rows = await AffairModel.fresh({
        storyIds: affair.story_ids, threadIds: await AffairModel.threadsOf(affair.story_ids), since, until: now,
        excluded: affair.story_ids, likeness: CLOSE_LIKENESS, limit: MAX_FRESH,
    });
    const month = new Date(+now - AFFAIR_DAYS * DAY_MS);
    const fresh = rows.length === 0 ? [] : await storiesWithNews(rows.map(row => ({id: row.id, via: 'fresh', likeness: row.likeness})), feedUrls, month);
    const stale = !affair.view.countedAt || +now - +new Date(affair.view.countedAt) > STALE_MS;
    // nothing new and counted lately: only the date of the check moves
    if (fresh.length === 0 && !stale) {
        await AffairModel.saveCheck(affair.id, {view: affair.view, storyIds: affair.story_ids, checkedAt: now, lastEventAt: null});
        return {alerts: [], accepted: 0};
    }
    const held = new Map((await storiesWithNews(affair.story_ids.map(id => ({id, via: 'held', likeness: 1})), feedUrls, month)).map(story => [story.storyId, story]));
    const result = await checkAffair({affair, fresh, held, now, usage});
    const newest = result.events.reduce((best, event) => event.at > best ? event.at : best, '');
    const grew = result.events.length > known.length || result.accepted > 0;
    await AffairModel.saveCheck(affair.id, {
        view: {...affair.view, events: result.events, coverage: result.coverage, countedAt: now.toISOString()},
        storyIds: result.stored, checkedAt: now, lastEventAt: grew && newest ? newest : null,
    });
    await AffairModel.addAlerts(affair.id, affair.id_user, result.alerts);
    return {alerts: result.alerts, accepted: result.accepted};
};
