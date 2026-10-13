//
//  Author: Fabian Rostello
//  Date: 13.10.2026
//  File: affair-names.js
//  Description: The stories of the last weeks naming the rare names of a card (the people and bodies the
//               tagger found in its news), for its other angles: the closest stories find the same
//               fact, these the other stances of the same actor
//

"use strict"

import {MentionModel} from "../../models/mention-model.js";
import {exactItems} from "./wikidata.js";
import {rareNames} from "./mentions.js";
import {mapWithConcurrency} from "./concurrency.js";

// The Latvian federation backing Čeferin (13.10.2026) was no angle of its own affair: its backing of
// Infantino, a week before, was 0.60-0.65 away when "Čeferin runs again" in 15 languages was 0.80-0.89
// (see anglesOf). Its name was the bridge: the LFF is named by a few dozen news a month, the UEFA by
// thousands. RARE_NEWS: a name of more news finds every news of its field. But "LFF" is the federation
// of Lithuania too, whose cup and leagues filled the 30 days: the stories naming them are taken the
// closest to the card first, from NAMED_LIKENESS (13.10.2026, the 21 stories naming the LFF: the same
// fact 0.91, the stances on Infantino's candidacy 0.64-0.65, the Lithuanian ones 0.37-0.58)
export const AFFAIR_DAYS = 30;
const RARE_NEWS = 400;
const NAMED_LIKENESS = 0.45;
const RARE_PER_CARD = 4;
// Wikidata asked now which item the rare names of the cards are, when the background has not yet (see
// tagging-service.js): the names of the same item in the other languages are looked for too. A few at
// most, Wikidata lets about 10 searches a minute through
const LINKED_NOW = 6;
const QUERIES = 5;

// The item of Wikidata of the names never looked for, a few at most: the rows given their qid
const linkNow = async (rows, budget) => {
    for (const row of rows.filter(row => !row.linkedAt)) {
        if (budget.left <= 0) return;
        budget.left--;
        try {
            const qids = await exactItems(row.name, row.lang ?? 'en');
            row.qid = qids.length === 1 ? qids[0] : null;
            await MentionModel.setLink(row.id, row.qid);
        } catch {
            return;                 // refused or down: the background links it later
        }
    }
};

// Map storyId -> [{id_story, id_article, shared, likeness}]: for each story, the stories of these feeds
// since 'since' that name its rare names (or a name of the same item), none of 'excluded', the closest
// to it first, 'perStory' at most; id_article their newest news naming them. A story whose news are not
// tagged yet has none
export const storiesOfSameNames = async (stories, {feedUrls, since, excluded, perStory}) => {
    const budget = {left: LINKED_NOW};
    const results = await mapWithConcurrency(stories, QUERIES, async (story) => {
        const articleIds = [...new Set(story.members.map(article => article.id).filter(Number.isInteger))];
        const names = rareNames(await MentionModel.namesOfArticles(articleIds, RARE_NEWS + 1), {rare: RARE_NEWS, max: RARE_PER_CARD});
        if (names.length === 0) return [];
        await linkNow(names, budget);
        return MentionModel.storiesNaming({
            storyId: story.storyId, likeness: NAMED_LIKENESS,
            mentionIds: names.map(name => name.id),
            qids: [...new Set(names.map(name => name.qid).filter(Boolean))],
            feedUrls, since, excluded: [...new Set([...excluded, story.storyId])], limit: perStory,
        });
    });
    const failed = results.filter(result => result.status !== 'fulfilled');
    if (failed.length > 0) console.error(`Briefing: the names of ${failed.length} cards were not looked for (${failed[0].reason?.message})`);
    return new Map(stories.map((story, i) => [story.storyId, results[i].status === 'fulfilled' ? results[i].value : []]));
};
