//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: old-news.js
//  Description: A story whose fact the media reported BEFORE the window of the briefing, and whose news of the window only tell it again (a medium
//               picking it up days later, a reminder, a recap, an opinion), is left out of the candidates: the reader of the last 24 hours does
//               not want a news known for days (a friend of the user, 10.11.2026: "des médias prennent une semaine avant de sortir un article
//               dessus, comme si c'était une actualité"). The AI judges, never the age alone
//

"use strict"

import {ollamaJson} from './ollama.js';

// What the user's friend asked for is "a news already known for a week is not repeated". The age alone is a bad judge: of the stories of the
// saved briefings whose first news is older than the window (26% of the cards), 27% were old news and 58% a new fact of the window (a result,
// a decision, a statement) in a story that had begun earlier; a rule on the age would have left out almost 2 new facts for 1 old news (bench/
// old-news-methods.mjs, 40 stories rated by hand before any method ran: "age" caught 10 of 11 old and lost 18 of 23 new). The AI, shown the
// earlier coverage next to the news of the window, caught 8 of 11 and lost 2 of 23; on a second set of 26 stories rated and drawn after, not
// used to tune the prompt, 4 of 7 and 0 of 17. A news is looked at only when media had told the story at least GRACE_HOURS before the window
// began: a fact told 26 hours ago is not older than the 24 hours of a briefing (with no grace, the same prompt lost 4 new facts of 23, not 2)
export const GRACE_HOURS = 12;
export const EARLIER = 5;           // news of the earlier coverage given for each story, one per medium, the closest to the story first (see StoryModel.earlierNews)
const IN_WINDOW = 8;                // news of the window given for each, one per medium, the newest
export const ASK_BY = 30;           // stories judged in one call
// A thread is a topic as much as an affair: a live briefing of 12.11.2026 (profile 7, bench/enzo-measure.mjs) left out 9 stories of 43 with the affairs, 5 of them on
// the news of their affair only, and two of those were another fact of the same topic (the changes of the Scottish legal sector against "taxing times for Scottish
// savers", an article on AI in the benefits administration against "why insurers struggle to scale AI") whose news were the least like the story (0.70 and 0.73
// the cosine of their text to its centroid). Only the news of the affair at least that like the story are given as earlier coverage
export const AFFAIR_LIKENESS = 0.75;

const DAY = 24 * 3600e3;

const spanOf = (hours) => hours > 24 ? `${Math.round(hours / 24)} days` : '24 hours';
const ago = (at, now) => {
    const days = (now - new Date(at)) / DAY;
    return days >= 1 ? `${Math.round(days * 10) / 10} days ago` : `${Math.max(1, Math.round(days * 24))} hours ago`;
};
const line = (row, now) => `- ${ago(row.at, now)}: ${row.title}`;

// one news per medium, in the order they are given
const onePerMedium = (rows) => rows.filter((row, at) => !row.medium || rows.findIndex(other => other.medium === row.medium) === at);

// The questions of one call. stories: [{id, title, earlier: [{at, title, medium}] the closest to the story first, within: [{at, title, medium}]}]
export const oldNewsPrompt = (stories, hours, now = Date.now()) => `A reader gets a daily news briefing of the last ${spanOf(hours)}. For each story: the headline the reader sees, what the media had already published BEFORE those ${spanOf(hours)} (the earlier coverage), then what they published during them.

${stories.map(story => `[${story.id}] Headline: "${story.title}"
Earlier coverage:
${story.earlier.map(row => line(row, now)).join('\n')}
During the last ${spanOf(hours)}:
${story.within.map(row => line(row, now)).join('\n')}`).join('\n\n')}

For each story, say whether the fact its headline tells is NEW in the last ${spanOf(hours)}: it happened, was announced, decided or revealed during them (a result, a new step, a new statement, a person or an organisation taking a stand).
It is OLD when that fact was already in the earlier coverage and the news of the last ${spanOf(hours)} only tell it again: other media picking it up late, a reminder, a recap, an analysis or an opinion on it, a reaction to something already known, or a preview of an event that has been played since.
It is NEW when it is the event itself after its announcement or its preview (the match played, the visit made, the vote held, the burning after the plan to burn), or a step further in the same affair (a semi-final won, then the final reached; a candidate then his programme; a decision taken after the talks).
When in doubt, it is old: the reader does not want to read the same news twice.
Answer in JSON only: {"stories": [{"id": "...", "earlier": "the earlier fact it repeats, in a few words, or null", "old": true or false}]}`;

// the stories answered old, only among the ones asked and only for true (never "true"): Map id -> the earlier fact the AI names (for the logs
// only: never shown, the AI writes it)
export const normalizeOld = (answer, stories) => {
    const known = new Set(stories.map(story => String(story.id)));
    return new Map((Array.isArray(answer?.stories) ? answer.stories : [])
        .filter(item => item?.old === true)
        .map(item => [String(item?.id ?? '').replace(/^\[|\]$/g, ''), typeof item?.earlier === 'string' ? item.earlier.slice(0, 200) : null])
        .filter(([id]) => known.has(id)));
};

// Map id -> earlier fact of the stories that tell an old news. A call that fails leaves its stories as they are
export const oldStories = async (stories, hours, {usage = null, now = Date.now(), judge = ollamaJson} = {}) => {
    const calls = [];
    for (let at = 0; at < stories.length; at += ASK_BY) calls.push(stories.slice(at, at + ASK_BY));
    const answers = await Promise.all(calls.map(group => judge(oldNewsPrompt(group, hours, now), usage)
        .then(answer => normalizeOld(answer, group))
        .catch(err => {
            console.error(`Briefing: ${group.length} stories were not judged old or new, all kept (${err.message})`);
            return new Map();
        })));
    return new Map(answers.flatMap(answer => [...answer]));
};

// The stories of a briefing without the ones that tell an old news, in their order. stories: [{storyId, members: [{at, title, medium}], followUp?}]
// the ones of the window; earlierOf: Map storyId -> [{at, title, medium}] the news told before the window began (see StoryModel.earlierNews), the
// closest to the story first. A story that follows a card of before (followUp, see repeats.js) was judged on what is new since, and a story with no news
// of the window or none of before has nothing to compare. Answers {stories, left: [{storyId, earlier}]}
export const withoutOldNews = async (stories, earlierOf, hours, {usage = null, now = Date.now(), judge = ollamaJson} = {}) => {
    const asked = stories.flatMap(story => {
        const earlier = onePerMedium(earlierOf.get(story.storyId) ?? []).slice(0, EARLIER);
        const within = onePerMedium([...story.members].sort((a, b) => new Date(a.at) - new Date(b.at))).slice(-IN_WINDOW);
        if (story.followUp || earlier.length === 0 || within.length === 0) return [];
        return [{id: String(story.storyId), title: story.best?.title ?? within.at(-1).title, earlier, within}];
    });
    if (asked.length === 0) return {stories, left: []};
    const old = await oldStories(asked, hours, {usage, now, judge});
    return {
        stories: stories.filter(story => !old.has(String(story.storyId))),
        left: [...old].map(([id, earlier]) => ({storyId: Number(id), earlier})),
    };
};

// A news told late after more than 48 hours of silence starts a story of its own (the grouping joins a news only to the stories of the last 48 hours), so
// its story holds no news from before the window and there is nothing to compare. Its affair (the thread of stories, see StoryModel.earlierInAffair) holds
// what the media had told: the earlier coverage of a story is completed with the news of its affair when its own story gives fewer than EARLIER media. On
// the 60 cards really delivered between 10 and 12.11.2026 (bench/late-news.mjs, one judge): 8 told a fact known before the window, 4 of them with no earlier
// news in their story. The age gate with the own story alone flagged 0 of the 8 and hid 0 of the 48 new facts; completed by the affair: 5 of the 8 and 2 of
// the 48 (the limit between "the same fact" and "a step further in the same affair" is the AI's). Completed in the map: the own news first, the affair's
// after (withoutOldNews keeps one news a medium, the first ones)
const completedByAffair = async (earlierOf, ids, {before, earlierInAffair}) => {
    if (!earlierInAffair) return 0;
    const short = ids.filter(id => onePerMedium(earlierOf.get(id) ?? []).length < EARLIER);
    if (short.length === 0) return 0;
    try {
        const rows = await earlierInAffair({storyIds: short, before, perStory: EARLIER, minimum: AFFAIR_LIKENESS});
        for (const found of rows) earlierOf.set(found.id_story, [...(earlierOf.get(found.id_story) ?? []), found]);
        return new Set(rows.map(found => found.id_story)).size;
    } catch (err) {
        // the age gate goes on with the news of the stories themselves: the affairs are a help, never a need
        console.error(`Briefing: the earlier news of the affairs were not looked for, the stories are judged on their own (${err.message})`);
        return 0;
    }
};

// The stories of a briefing without the ones that tell an old news: the news told before the window began (GRACE_HOURS before its start, since) are read
// with earlierNews({storyIds, before, perStory}), completed for the stories that hold few of them with the news of their affair (earlierInAffair, same
// shape, null leaves it out), the briefing never fails on it: all the stories are kept when something goes wrong, and when every one is judged old (that
// is no briefing)
export const notOldNews = async (stories, {since, hours, usage = null, earlierNews, earlierInAffair = null, judge = ollamaJson, now = Date.now()}) => {
    try {
        const ids = stories.filter(story => !story.followUp).map(story => story.storyId);
        if (ids.length === 0) return stories;
        const before = new Date(new Date(since).getTime() - GRACE_HOURS * 3600e3);
        const rows = await earlierNews({storyIds: ids, before, perStory: EARLIER});
        const earlierOf = new Map();
        for (const found of rows) earlierOf.set(found.id_story, [...(earlierOf.get(found.id_story) ?? []), found]);
        const withAffair = await completedByAffair(earlierOf, ids, {before, earlierInAffair});
        const result = await withoutOldNews(stories, earlierOf, hours, {usage, now, judge});
        if (result.left.length > 0 || withAffair > 0) {
            console.log(`Briefing: ${result.left.length} stories left out, the media told their news before the last ${spanOf(hours)} and only tell it again (${withAffair} stories compared with the news of their affair)${
                result.left.map(({storyId, earlier}) => `
  [${storyId}] ${earlier ?? ''}`).join('')}`);
        }
        return result.stories.length > 0 ? result.stories : stories;
    } catch (err) {
        console.error(`Briefing: the news told before the window were not looked for (${err.message})`);
        return stories;
    }
};
