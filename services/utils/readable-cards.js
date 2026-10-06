//
//  Author: Fabian Rostello
//  Date: 06.10.2026
//  File: readable-cards.js
//  Description: The cards of a briefing are the stories of which an article could be read: a story
//               no article of which could be read (a paywall, a protected site, its first lines only)
//               gives way to the next story the AI chose
//

"use strict"

// A card with nothing read showed its title and "No article of this story could be read" (a story of
// faz.net alone, 6.10.2026): the reader learnt nothing from it. The AI chooses more stories than a
// briefing keeps (see MAX_CHOSEN): the next ones replace such cards, read only when one is missing.
// Rounds of reading after the first one, each one for the cards still missing: a round is a few pages
// and AI calls, the briefing waits for it
export const MAX_REFILLS = 2;

// main: the stories of the briefing, in their order; reserve: the next stories chosen, in theirs
// read: async (stories) => [{story, unreadable, ...}] for the stories read, unreadable when no article
// of the story could be read (a story may be left out, a page of Google News that is no news)
// Answers the results of the stories read that could be, the ones of main first in their order, then
// the ones of the reserve that took the places left, and how many stories could not be read
export const readableCards = async (main, reserve, read, {maxRefills = MAX_REFILLS} = {}) => {
    const wanted = main.length;
    const kept = [];
    let unreadable = 0;
    const take = (results) => {
        for (const result of results) {
            if (result.unreadable) unreadable++;
            else if (kept.length < wanted) kept.push(result);
        }
    };
    take(await read(main));
    const next = [...reserve];
    for (let refill = 0; refill < maxRefills && kept.length < wanted && next.length > 0; refill++) {
        take(await read(next.splice(0, wanted - kept.length)));
    }
    return {cards: kept, unreadable};
};
