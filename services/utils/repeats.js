//
//  Author: Fabian Rostello
//  Date: 13.10.2026
//  File: repeats.js
//  Description: A story the profile read in the last days (a card it sent itself by e-mail) is not shown
//               again, unless news published since tell something new of it: then it comes back as a
//               follow-up. Another story of the same affair (its thread, db/add_threads.sql) is shown only
//               when it tells something new too, and says which card of before it follows
//

"use strict"

import {ollamaJson} from './ollama.js';

// The user (13.10.2026): "not the same story 2 days in a row, unless it evolved". This reverses the
// choice of 30.09.2026 (a repeated card is passed by the reader, excluding left fewer news to choose
// from): the stories read in the last REPEAT_HOURS are left out before the AI chooses, the ones with
// news since are asked whether they evolved. Read: sent by e-mail (the user, 14.10.2026: "not sent by
// e-mail = not read"); every card of the briefings of 48 h counted until then, a briefing written
// again within 3 h excepted
export const REPEAT_HOURS = 48;
const MAX_ASKED = 30;               // stories shown before whose news since are judged, the closest first
const NEW_TITLES = 6;               // news since given for each, the newest first
const DESCRIPTION_CHARS = 200;

// The cards of the briefings of before: Map storyId -> {title, shownAt}, the last time each was shown.
// rows: [{storyId, mergedStoryIds, title, shownAt}] the oldest first (see BriefingModel.sentSince); a
// card joined other stories of its news, they were shown with it. A card added by the reader (a negative
// id, see importNews) is of no story
export const shownStories = (rows) => {
    const shown = new Map();
    for (const row of rows) {
        const shownAt = new Date(row.shownAt);
        for (const id of [row.storyId, ...(Array.isArray(row.mergedStoryIds) ? row.mergedStoryIds : [])]) {
            if (Number.isInteger(id) && id > 0) shown.set(id, {title: row.title, shownAt});
        }
    }
    return shown;
};

const brief = (article) => `${article.title}${article.description
    ? ` — ${String(article.description).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_CHARS)}` : ''}`;

export const evolutionPrompt = (stories) => `A reader already read these news in an earlier briefing. For each one, here is the title they read, then news of the same affair published since or around it.

${stories.map(story => `[${story.id}] Read: "${story.title}"
News:
${story.since.map(article => `- ${brief(article)}`).join('\n')}`).join('\n\n')}

For each one, say whether the news tell the reader something NEW: a fact the title read does not tell,
that happened after it or beside it (a new step, decision, result, official reaction, figure,
consequence, another party taking a stand).
The same fact told again, by other media, in other words or another language, with more details of the
same moment, an analysis, an opinion or a reminder is NOT new. When in doubt, it is not new: the reader
does not want to read the same news twice.
Answer in JSON only: {"stories": [{"id": "...", "fact": "the new fact, in a few words, or null", "evolved": true or false}]}`;

// the stories that tell something new, only among the ones asked and only for true (never "true"):
// Map id -> the new fact the AI names (for the logs only: never shown, the AI writes it)
export const normalizeEvolutions = (answer, stories) => {
    const known = new Set(stories.map(story => String(story.id)));
    return new Map((Array.isArray(answer?.stories) ? answer.stories : [])
        .filter(item => item?.evolved === true)
        .map(item => [String(item?.id ?? '').replace(/^\[|\]$/g, ''), typeof item?.fact === 'string' ? item.fact.slice(0, 200) : null])
        .filter(([id]) => known.has(id)));
};

// stories: [{id, title, since: [{title, description}]}]: Map id -> fact of the ones that tell something new
export const evolvedStories = async (stories, usage = null) =>
    stories.length === 0 ? new Map() : normalizeEvolutions(await ollamaJson(evolutionPrompt(stories), usage), stories);

// The stories of a briefing without the ones shown before, in their order. stories: [{storyId, members:
// [{at, title, description}]}] the closest first; shown: see shownStories; threadOf: Map storyId ->
// thread, of these stories and of the ones shown; evolved: (asked) -> Map id -> fact (see
// evolvedStories), its failure leaves every story of an affair shown before out.
// A story shown before is asked with its news since (none: left out). Another story of an affair shown
// is asked too, with its news since or, when it has none, all of them: the grouping splits one fact in
// two stories now and then ("LFF will support Čeferin" and "LFF nominated Čeferin", 12.10.2026). A story
// kept gets followUp {storyId, title, shownAt, evolved}: evolved when it is the story shown, with news
// since (they are read first, see toRead in briefing-service.js), else another story of its affair.
// Answers {stories, left, back: [{storyId, fact}]}
export const withoutRepeats = async (stories, shown, threadOf, evolved) => {
    if (shown.size === 0) return {stories, left: 0, back: []};
    // the last card of each affair shown
    const byThread = new Map();
    for (const [storyId, card] of shown) {
        const thread = threadOf.get(storyId);
        if (thread === null || thread === undefined) continue;
        const known = byThread.get(thread);
        if (!known || known.card.shownAt < card.shownAt) byThread.set(thread, {storyId, card});
    }
    // the card each story repeats or follows: {storyId, card, same}
    const before = new Map(stories.flatMap(story => {
        if (shown.has(story.storyId)) return [[story.storyId, {storyId: story.storyId, card: shown.get(story.storyId), same: true}]];
        const affair = byThread.get(threadOf.get(story.storyId));
        return affair ? [[story.storyId, {...affair, same: false}]] : [];
    }));
    const asked = stories.filter(story => before.has(story.storyId)).slice(0, MAX_ASKED).flatMap(story => {
        const {card, same} = before.get(story.storyId);
        const since = story.members.filter(article => article.at > card.shownAt);
        const news = since.length > 0 || same ? since : story.members;
        return news.length > 0 ? [{story, card, news}] : [];
    });
    const yes = asked.length === 0 ? new Map() : await evolved(asked.map(({story, card, news}) => ({
        id: String(story.storyId),
        title: card.title,
        since: [...news].sort((a, b) => b.at - a.at).slice(0, NEW_TITLES),
    }))).catch(err => {
        console.error(`Briefing: the stories of the affairs shown before were not judged, all left out (${err.message})`);
        return new Map();
    });

    let left = 0;
    const kept = stories.flatMap(story => {
        const repeated = before.get(story.storyId);
        if (!repeated) return [story];
        if (!yes.has(String(story.storyId))) {
            left++;
            return [];
        }
        return [{...story, followUp: {storyId: repeated.storyId, title: repeated.card.title, shownAt: repeated.card.shownAt.toISOString(), evolved: repeated.same}}];
    });
    return {stories: kept, left, back: [...yes].map(([storyId, fact]) => ({storyId: Number(storyId), fact}))};
};
