//
//  Author: Fabian Rostello
//  Date: 04.11.2026
//  File: affair.js
//  Description: An affair built from one card: the stories around it found by their thread, their vectors and the
//               names of the card, the ones that belong to it told apart by the AI, then its events in time order
//               and how widely the media talked of it
//

"use strict"

import {AffairModel} from '../../models/affair-model.js';
import {StoryModel} from '../../models/story-model.js';
import {AFFAIR_DAYS, storiesOfSameNames} from './affair-names.js';
import {affairFileOf, FACTS_SHOWN, JUDGED_AT_ONCE, judgeStories, sameFactEvents} from './affair-judge.js';
import {datedAt, eventsOf, joinedEvents} from './affair-events.js';
import {coverageOf} from './affair-coverage.js';
import {mapWithConcurrency} from './concurrency.js';
import {translatedTitles} from './title-translation.js';
import {scriptLanguage, writtenIn} from './language.js';
import {newUsage} from './ollama.js';
import {cleanTitle} from './titles.js';

// The closest stories of the month are an exact scan; below this likeness a story is not of the card's field
// (the stories of the thread are taken whatever they score: the grouping put them there). Measured on the
// affair of UEFA against Infantino: the 70 closest were all above 0.80 (an affair of 12 languages), a small
// affair's closest are at 0.55 after its first ten
const CLOSE_PER_STORY = 80;
export const CLOSE_LIKENESS = 0.62;
const NAMED_PER_STORY = 30;
const MAX_POOL = 160;
const AI_CONCURRENCY = 3;

const byTime = (a, b) => a.at - b.at || a.storyId - b.storyId;

// The stories of 'ids' with their news the reader can read (feedUrls), the ones without any left out:
// [{storyId, lang, via, likeness, createdAt, news, media, at}], the oldest first
export const storiesWithNews = async (rows, feedUrls, since) => {
    const ids = rows.map(row => row.id);
    const [stories, news] = await Promise.all([AffairModel.stories(ids), AffairModel.newsOf({storyIds: ids, feedUrls, since})]);
    const newsOf = new Map(ids.map(id => [id, []]));
    for (const item of news) {
        const title = cleanTitle(item.title, item.medium);
        // the label of a news is its feed's when the words cannot tell: a title in Persian letters is Persian (see scriptLanguage)
        newsOf.get(item.id_story).push({...item, title, lang: scriptLanguage(title, item.lang) ?? item.lang});
    }
    const rowOf = new Map(rows.map(row => [row.id, row]));
    return stories.filter(story => newsOf.get(story.id).length > 0).map(story => {
        const items = newsOf.get(story.id);
        const row = rowOf.get(story.id);
        return {
            storyId: story.id, lang: scriptLanguage(items[0].title, story.lang) ?? story.lang, via: row.via, likeness: row.likeness, createdAt: story.created_at,
            news: items, media: [...new Set(items.map(item => item.medium).filter(Boolean))],
            at: datedAt(items[0].at, story.created_at),
        };
    }).sort(byTime);
};

// The titles of these events in the language of the reader (language: a code), the ones in another language only (see
// translatedTitles: the language of a title is read from its letters, the label of its feed being English for a Persian or Czech
// paper). The event takes the language its title is really written in. The ones already translated are left; one the AI could not
// translate stays without. Each event is asked once (translationChecked): the ones of an affair followed before this existed are asked
// when it is opened (see AffairService.detail). Answers the events
export const translateEvents = async (events, language, usage = null) => {
    const wanted = events.filter(event => !event.titleTranslation && !event.translationChecked);
    const answers = await translatedTitles(wanted.map(event => ({title: event.title, label: event.language})), language, usage);
    wanted.forEach((event, i) => {
        event.language = answers[i].language ?? event.language;
        event.titleTranslation = answers[i].translation;
        event.translationChecked = true;
    });
    for (const event of events) event.titleTranslation ??= null;
    return events;
};

// The news the grouping put with a card as one affair, given to the AI to name it: the closest to the card, oldest
// first. pool: see storiesWithNews
const factsOfThread = (pool) => pool.filter(story => story.via === 'thread').sort((a, b) => b.likeness - a.likeness).slice(0, FACTS_SHOWN).sort(byTime)
    .map(story => ({title: story.news[0].title, at: story.at}));

// The file of the affair of a card, read from its thread only (a few ms of the database and one short call of the
// AI): {title, written, proposed, about, not}, null when the news of the card are no affair. What the card
// shows before the reader opens the affair (see AffairService.chips), and what buildAffair judges the stories by
export const affairFile = async ({storyId, title, language, feedUrls, usage = newUsage(), now = new Date()}) => {
    const since = new Date(+now - AFFAIR_DAYS * 24 * 3600e3);
    const pool = await storiesWithNews(await AffairModel.candidates({storyId, days: AFFAIR_DAYS, perStory: 0}), feedUrls, since);
    const facts = factsOfThread(pool);
    return affairFileOf(title, facts.length > 0 ? facts : [{title, at: now}], {language: writtenIn(language) ?? 'English', usage});
};

// The affair of a card, from its story. title: the title of the card as the reader reads it; language: the
// reader's (a code); feedUrls: the feeds the reader reads; file: its file when already made (see affairFile).
// Answers {affair: false} when the news of the card are no affair (a field, a series: see affairFilePrompt),
// else {affair: true, title, about, written, events, coverage, pool}: events: see eventsOf, coverage: see
// coverageOf, pool: how many stories were found, judged and kept (for the logs and the benches)
export const buildAffair = async ({storyId, title, language, feedUrls, file = undefined, usage = newUsage(), now = new Date(), trace = false, closePerStory = CLOSE_PER_STORY, maxPool = MAX_POOL}) => {
    const since = new Date(+now - AFFAIR_DAYS * 24 * 3600e3);
    const rows = (await AffairModel.candidates({storyId, days: AFFAIR_DAYS, perStory: closePerStory}))
        .filter(row => row.via === 'thread' || row.likeness >= CLOSE_LIKENESS)
        .sort((a, b) => b.likeness - a.likeness).slice(0, maxPool);
    if (rows.length === 0) return {affair: false};
    let pool = await storiesWithNews(rows, feedUrls, since);

    // the stories that name the card's rare names (people, bodies), whatever their vector: the Latvian
    // federation backing Infantino a week before backing Čeferin (see affair-names.js)
    const seed = pool.find(story => story.storyId === storyId);
    if (seed) {
        const named = (await storiesOfSameNames([{storyId, members: seed.news}], {feedUrls, since, excluded: pool.map(story => story.storyId), perStory: NAMED_PER_STORY})
            .catch(err => {
                console.error(`Affair ${storyId}: no story of the same names looked for (${err.message})`);
                return new Map();
            })).get(storyId) ?? [];
        const extra = named.slice(0, Math.max(0, maxPool - pool.length)).map(row => ({id: row.id_story, via: 'named', likeness: row.likeness ?? 0}));
        if (extra.length > 0) pool = (await storiesWithNews(extra, feedUrls, since)).concat(pool).sort(byTime);
    }

    // the news of the thread name the affair, unless its file is made already
    const facts = factsOfThread(pool);
    if (file === undefined) {
        file = await affairFileOf(title, facts.length > 0 ? facts : [{title, at: seed?.at ?? now}], {language: writtenIn(language) ?? 'English', usage});
    }
    if (!file) return {affair: false, pool: {found: pool.length}};

    // the stories judged by the AI against the file, oldest first, in calls of JUDGED_AT_ONCE: a fact told in
    // two languages the same day is in one call, and "as" points to an earlier story of that call
    const chunks = Array.from({length: Math.ceil(pool.length / JUDGED_AT_ONCE)}, (_, i) => pool.slice(i * JUDGED_AT_ONCE, (i + 1) * JUDGED_AT_ONCE));
    const verdicts = await mapWithConcurrency(chunks, AI_CONCURRENCY, chunk =>
        judgeStories(file, facts, chunk.map(story => ({title: story.news[0].title, at: story.at, lang: story.lang})), usage));
    const failed = verdicts.find(result => result.status !== 'fulfilled');
    if (failed) throw failed.reason;
    const all = chunks.flatMap((chunk, c) => chunk.map((story, i) => {
        const verdict = verdicts[c].value[i];
        return {story, verdict, at: story.at, asStory: verdict.as === null ? null : chunk[verdict.as].storyId};
    }));
    const judged = all.filter(item => item.verdict.in);
    if (judged.length === 0) return {affair: false, pool: {found: pool.length, kept: 0}};

    const pairs = [...new Set(judged.flatMap(item => item.asStory === null ? [] : [item.story.storyId, item.asStory]))];
    const likeness = new Map((pairs.length < 2 ? [] : await StoryModel.likenessAmong(pairs).catch(err => {
        console.error(`Affair ${storyId}: the stories telling one fact were not compared (${err.message})`);
        return [];
    })).map(row => [`${row.a}:${row.b}`, row.likeness]));
    const found = eventsOf(judged, {language, likeness: (a, b) => likeness.get(`${Math.min(a, b)}:${Math.max(a, b)}`) ?? 0});
    // the events reread all together: a fact told in the next call is joined to the one it repeats; the AI failing
    // leaves them as they are
    const same = await sameFactEvents(file, found, usage).catch(err => {
        console.error(`Affair ${storyId}: the events telling one fact were not joined (${err.message})`);
        return [];
    });
    const events = joinedEvents(found, same, language);

    // the titles of another language than the reader's, translated (marked as translated by the client)
    await translateEvents(events, language, usage);

    return {
        affair: true,
        title: file.title, written: file.written, proposed: file.proposed, about: file.about, not: file.not,
        events,
        coverage: coverageOf(judged.map(item => item.story)),
        pool: {found: pool.length, kept: judged.length, events: events.length},
        // every story of the pool with the verdict on it, for the benches
        ...(trace ? {trace: all.map(item => ({storyId: item.story.storyId, lang: item.story.lang, via: item.story.via, likeness: item.story.likeness,
            at: item.at, title: item.story.news[0].title, media: item.story.media.length, ...item.verdict, asStory: item.asStory}))} : {}),
    };
};
