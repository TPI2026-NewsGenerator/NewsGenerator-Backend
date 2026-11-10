//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: foreign-versions.js
//  Description: The stories of other languages that join a card as versions of its news (see keepSameNews of briefing-service.js). The vectors
//               find the stories of another language near a card, and the check of the articles ("the same news, reactions and analyses
//               too: when in doubt keep") kept them. It kept too many: the briefing of Roberto 657 of 10.11.2026 joined to the card of the
//               comment of the head of the referees on the goal of a match the Croatian news of the outburst of a coach after the same
//               match, 6 of the 9 media of the card were of that other news, and "Another version" linked the card of another profile to
//               it (the user: "est-ce que c'est correct ? ses 2 nouvelles sont de la même histoire ?"). Joining by mistake hides a news.
//               Such a story now joins a card only when the question of the same FACT (mergeStories: "two facts of one affair are not the same
//               fact; when in doubt, no") agrees too. Of the 1 177 stories joined to the cards of the last 80 briefings, the question
//               agreed with 771 and disagreed with 406. 70 of them (35 and 35) rated blind by two raters (they agree on 94 %): the
//               question kept 32 of 35 that were the same news and left out 23 of 35 that were another fact of the same affair, so,
//               extrapolated, the joins as they were held 68 % of the same news, with the question 91 %, at the price of 12 % of the true
//               joins (93 of 798). A news not joined is not lost: it stays a story of its own (a card, an angle, or folded into a card by
//               the AI that reads the cards, see card-merge.js)
//

"use strict"

import process from 'node:process';
import {mergeStories} from './profile-ai.js';

// The versions that agree, by card: Map storyId -> [version]. cards: the cards that have versions kept by the check, foreignOf(card): the
// ones kept, briefOf(story): {title, description} of a card or a version (its best article). One call lists the cards, then the versions: a
// version joins its card when the answer of the AI says it is the fact of that card (a chain through another version leads to the card
// too). The AI failing joins none: a news hidden by mistake is worse than a story not joined. AI_STRICT_VERSIONS=off keeps all the versions the
// check kept
export const agreedVersions = async (cards, foreignOf, briefOf, usage = null, log = console) => {
    const agreed = new Map(cards.map(card => [card.storyId, []]));
    const asked = cards.filter(card => foreignOf(card).length > 0);
    if (asked.length === 0) return agreed;
    const kept = asked.reduce((sum, card) => sum + foreignOf(card).length, 0);
    if (process.env.AI_STRICT_VERSIONS === 'off') {
        for (const card of asked) agreed.set(card.storyId, foreignOf(card));
        return agreed;
    }
    const list = new Map();
    for (const card of asked) list.set(String(card.storyId), {id: String(card.storyId), lead: briefOf(card)});
    for (const card of asked) for (const version of foreignOf(card)) if (!list.has(String(version.storyId))) list.set(String(version.storyId), {id: String(version.storyId), lead: briefOf(version)});
    let merges = null;
    try {
        merges = await mergeStories([...list.values()], usage);
    } catch (err) {
        log.error(`Briefing: the stories of other languages were not compared with their card, none joined (${err.message})`);
    }
    let joined = 0;
    for (const card of asked) {
        const same = merges ? foreignOf(card).filter(version => merges.get(String(version.storyId)) === String(card.storyId)) : [];
        agreed.set(card.storyId, same);
        joined += same.length;
    }
    log.log(`Briefing: ${kept} versions in other languages kept by the check, ${joined} agreed by the question of the same fact`);
    return agreed;
};
