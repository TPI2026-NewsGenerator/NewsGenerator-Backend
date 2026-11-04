//
//  Author: Fabian Rostello
//  Date: 04.11.2026
//  File: affair-events.js
//  Description: The events of an affair from the stories judged to belong to it: the stories telling one fact
//               (in several languages) joined, each dated, with how widely it was told and whether its news
//               report it, announce it or deny it. No AI here: the verdicts are given
//

"use strict"

import {hedgedBy} from './hedging.js';
import {hasDenial} from './contested.js';
import {hasStatement} from './statements.js';

// The day of a story is when its first news was published, unless the feed got it wrong: a page re-dated
// (an archive published again) or dated in the future. We saw a story's first news when it was created, and the
// grouping only joins news of the last 48 hours, so a date more than 3 days before or half a day after that is
// the feed's mistake, and the day we saw it stands
const BEFORE_MS = 72 * 3600e3;
const AFTER_MS = 12 * 3600e3;
export const datedAt = (publishedAt, createdAt) => {
    const created = new Date(createdAt);
    const published = publishedAt ? new Date(publishedAt) : null;
    if (published && !Number.isNaN(published.getTime()) && published >= created - BEFORE_MS && published <= +created + AFTER_MS) return published;
    return created;
};

// Two stories tell one fact when the AI says so ("as") and their vectors agree. Measured on the other angles of 47
// cards (bench/angles-dups.mjs): the true repeats were 0.82 to 0.97 apart, the AI's word alone also joined two
// steps of one affair (a suspension and its softening), the likeness alone joined every angle at 0.70
export const SAME_FACT_LIKENESS = 0.80;
const SAME_FACT_DAYS = 3;

// the stories joined, as arrays of story ids in the order of 'stories' ([{storyId, at, as, denial}], as: the story
// id it repeats or null, denial: the AI says it reports a denial); likeness(a, b): of two story ids. A denial is a
// step of its own: told apart from what it denies, whatever the AI says of the two (FIFA's denial of the second
// salary of Infantino was joined to the revelation on 4.11.2026 and marked it "denied")
export const factsOf = (stories, likeness) => {
    const group = new Map(stories.map(story => [story.storyId, story.storyId]));
    const root = (id) => group.get(id) === id ? id : root(group.get(id));
    for (const story of stories) {
        const earlier = stories.find(other => other.storyId === story.as);
        if (!earlier || likeness(story.storyId, earlier.storyId) < SAME_FACT_LIKENESS) continue;
        if (Boolean(story.denial) !== Boolean(earlier.denial)) continue;
        if (Math.abs(story.at - earlier.at) > SAME_FACT_DAYS * 24 * 3600e3) continue;
        group.set(root(story.storyId), root(earlier.storyId));
    }
    const facts = new Map();
    for (const story of stories) facts.set(root(story.storyId), [...(facts.get(root(story.storyId)) ?? []), story.storyId]);
    return [...facts.values()];
};

// A fact is "reported" when the news that tell it say they have no confirmation (see hedging.js): half of them
// at least, or any when there are two or fewer. One hedged paper among a hundred does not make a rumour of an
// announcement; the scoop of a single paper does
export const reportedBy = (news) => {
    const hedges = news.map(item => hedgedBy(item.title, item.description)).filter(Boolean);
    if (hedges.length === 0 || (news.length > 2 && hedges.length < news.length / 2)) return null;
    const count = new Map();
    for (const hedge of hedges) count.set(hedge, (count.get(hedge) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1])[0][0];
};

// The marks of a fact: what the AI said of it ("denial", "official") counts only when the words of one of its
// news say it too (a verb of denial, a statement or a release, see contested.js and statements.js), as the cards
// do: the AI alone said "official" of every announcement a journalist made
// a denial the AI reports and a verb of denial in the words of one of the news says too
export const denialOf = (news, says) => says && news.some(item => hasDenial(`${item.title}. ${item.description ?? ''}`, item.lang));

export const marksOf = (news, says) => {
    const denial = denialOf(news, says.includes('denial'));
    return {
        // a denial speaks of the rumour it denies: it is not itself reported
        reported: denial ? null : reportedBy(news),
        official: says.includes('official') && news.some(item => hasStatement(`${item.title}. ${item.description ?? ''}`)),
        denial,
    };
};

// A fact is a key event when the AI says it brings something new AND it is not one paper's word alone: told by two
// media at least, or announced by the party itself, or denied by it. The scoop of one medium joins the timeline
// as a minor event, and becomes key when others tell it (they join the same event)
export const isKey = (kind, media, marks) => kind === 'key' && (media >= 2 || Boolean(marks.official || marks.denial));

// The lead of a fact, the news its card shows: a story in the language of the reader first (no translation
// needed), the most told one among them, its oldest news with a title. stories: [{lang, media, news}]
export const leadOf = (stories, language) => {
    const told = [...stories].sort((a, b) => (b.lang === language) - (a.lang === language) || b.media.length - a.media.length);
    const story = told.find(one => one.news.some(item => item.title)) ?? told[0];
    return {story, news: story.news.find(item => item.title) ?? story.news[0]};
};

// The events joined by groups of indexes (the ones the AI says tell one fact, see sameFactEvents): a group is
// kept whole only while its events are within SAME_FACT_DAYS of its first one and are all denials or none is,
// the others stand alone. The
// joined event takes the lead of the one told in the language of the reader, else the most told; its media
// and news are all of theirs, it is "key" when one is, and carries the marks of any
export const joinedEvents = (events, groups, language) => {
    const joined = new Set();
    const merged = groups.map(group => {
        const first = events[group[0]];
        const members = group.filter(i => Math.abs(+new Date(events[i].at) - +new Date(first.at)) <= SAME_FACT_DAYS * 24 * 3600e3
            && events[i].denial === first.denial).map(i => events[i]);
        if (members.length < 2) return null;
        group.forEach(i => { if (members.includes(events[i])) joined.add(i); });
        const lead = [...members].sort((a, b) => (b.language === language) - (a.language === language) || b.media.length - a.media.length)[0];
        const media = [...new Set(members.flatMap(event => event.media))];
        const official = members.some(event => event.official);
        const denial = members.some(event => event.denial);
        const aiKey = members.some(event => event.aiKey);
        return {
            ...lead,
            storyIds: members.flatMap(event => event.storyIds),
            at: members.map(event => event.at).sort()[0],
            aiKey,
            kind: isKey(aiKey ? 'key' : 'minor', media.length, {official, denial}) ? 'key' : 'minor',
            media,
            news: members.reduce((sum, event) => sum + event.news, 0),
            languages: [...new Set(members.flatMap(event => event.languages))],
            reported: denial ? null : members.map(event => event.reported).find(Boolean) ?? null,
            official,
            denial,
        };
    }).filter(Boolean);
    return [...events.filter((_, i) => !joined.has(i)), ...merged].sort((a, b) => a.at.localeCompare(b.at));
};

// The events of an affair, the oldest first. judged: [{story, verdict, at, asStory}] the stories judged in (story:
// {storyId, lang, media, news}, verdict: see normalizeJudged, at: see datedAt, asStory: the id of the story the
// verdict says it repeats, or null); likeness(a, b): of two story ids. An event:
//  id (its lead story), storyIds, at, kind ('key' when a story of it is), title, url, medium, language, media (all
//  the media that told it, in any language), news (how many), languages, reported (the words it hedges with, or
//  null), official, denial
export const eventsOf = (judged, {language, likeness}) => {
    const byId = new Map(judged.map(item => [item.story.storyId, item]));
    const facts = factsOf(judged.map(item => ({storyId: item.story.storyId, at: +item.at, as: item.asStory ?? null, denial: denialOf(item.story.news, item.verdict.says === 'denial')})), likeness);
    return facts.map(ids => {
        const members = ids.map(id => byId.get(id));
        const stories = members.map(item => item.story);
        const {story, news} = leadOf(stories, language);
        const media = [...new Set(stories.flatMap(one => one.media))];
        const all = stories.flatMap(one => one.news);
        const marks = marksOf(all, members.map(item => item.verdict.says).filter(Boolean));
        return {
            id: story.storyId,
            storyIds: ids,
            at: new Date(Math.min(...members.map(item => +item.at))).toISOString(),
            aiKey: members.some(item => item.verdict.kind === 'key'),
            kind: isKey(members.some(item => item.verdict.kind === 'key') ? 'key' : 'minor', media.length, marks) ? 'key' : 'minor',
            title: news.title,
            url: news.resolved_link ?? news.link,
            medium: news.medium,
            language: story.lang,
            media,
            news: all.length,
            languages: [...new Set(stories.map(one => one.lang))],
            ...marks,
        };
    }).sort((a, b) => a.at.localeCompare(b.at));
};

// The marks and counts of an event once others told it: its media and news grow, a key event is one when the AI
// said so and two media tell it (see isKey). 'others': the events it absorbs
const grown = (event, others) => {
    const members = [event, ...others];
    const media = [...new Set(members.flatMap(one => one.media))];
    const official = members.some(one => one.official);
    const aiKey = members.some(one => one.aiKey);
    return {
        ...event,
        storyIds: [...new Set(members.flatMap(one => one.storyIds))],
        at: members.map(one => one.at).sort()[0],
        media, news: members.reduce((sum, one) => sum + one.news, 0),
        languages: [...new Set(members.flatMap(one => one.languages))],
        aiKey, official,
        reported: event.denial ? null : members.map(one => one.reported).find(Boolean) ?? null,
        kind: isKey(aiKey ? 'key' : 'minor', media.length, {official, denial: event.denial}) ? 'key' : 'minor',
    };
};

// The events found since the last check among the ones the reader has. groups: the events the AI says tell one fact
// among [...known, ...fresh], by index (see sameFactEvents). A fresh event that tells a known one is added to it (it
// keeps its place, its title and what was said of it: the reader was told already); the fresh ones telling one
// fact among themselves are joined; the others stand alone. A group of two known events, a fresh event more than
// three days from the known one or a denial of what it does not deny, stands alone too.
// Answers {events, touched}: all the events, the oldest first, and the ids of the ones new or grown
export const mergedNew = (known, fresh, groups, language) => {
    const into = new Map();     // index of a known event -> the fresh events it absorbs
    const used = new Set();     // indexes of the fresh events absorbed
    const among = [];           // groups of fresh events only
    for (const group of groups) {
        const knownAt = group.filter(i => i < known.length);
        const freshAt = group.filter(i => i >= known.length).map(i => i - known.length);
        if (freshAt.length === 0 || knownAt.length > 1) continue;
        if (knownAt.length === 1) {
            const target = known[knownAt[0]];
            const fit = freshAt.filter(i => !used.has(i) && Math.abs(+new Date(fresh[i].at) - +new Date(target.at)) <= SAME_FACT_DAYS * 24 * 3600e3
                && Boolean(fresh[i].denial) === Boolean(target.denial));
            fit.forEach(i => used.add(i));
            if (fit.length > 0) into.set(knownAt[0], [...(into.get(knownAt[0]) ?? []), ...fit.map(i => fresh[i])]);
        } else {
            among.push(freshAt);
        }
    }
    const rest = fresh.map((_, i) => i).filter(i => !used.has(i));
    const joined = joinedEvents(rest.map(i => fresh[i]), among.map(group => group.filter(i => rest.includes(i)).map(i => rest.indexOf(i))).filter(group => group.length >= 2), language);
    const touched = new Set([...[...into.keys()].map(i => known[i].id), ...joined.map(event => event.id)]);
    const events = [...known.map((event, i) => into.has(i) ? grown(event, into.get(i)) : event), ...joined].sort((a, b) => a.at.localeCompare(b.at));
    return {events, touched};
};

// An event again from the stories of the moment (storyById: story id -> {media, news, lang}): the media that told it
// since are added, never taken away (a story the feeds no longer hold must not shrink it), and it becomes key when
// the AI had found it key and a second medium told it
export const refreshedEvent = (event, storyById) => {
    const stories = event.storyIds.map(id => storyById.get(id)).filter(Boolean);
    if (stories.length === 0) return event;
    const media = [...new Set([...event.media, ...stories.flatMap(story => story.media)])];
    const links = new Set(stories.flatMap(story => story.news.map(item => item.link)));
    return {
        ...event, media, news: Math.max(event.news, links.size),
        languages: [...new Set([...event.languages, ...stories.map(story => story.lang)])],
        kind: isKey(event.aiKey ? 'key' : 'minor', media.length, event) || event.kind === 'key' ? 'key' : 'minor',
    };
};
