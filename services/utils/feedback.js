//
//  Author: Fabian Rostello
//  Date: 25.09.2026
//  File: feedback.js
//  Description: What the reader said of the cards (a thumb up or down): examples for the AI that
//               chooses, and the sources found for the profile that keep bringing refused cards
//

"use strict"

export const MAX_EXAMPLES = 15;         // titles liked and titles refused given to the AI, the newest
export const MIN_REFUSED = 3;           // cards refused before a source found for the profile is left out

// votes: [{title, vote: 'up' | 'down', feedUrls}], the newest first
// The titles as examples, not as vectors: on the benches, the refusals turned into vectors removed
// good stories along with the bad ones; the AI reads what the reader meant ("no predictions")
export const examplesOf = (votes) => ({
    liked: votes.filter(vote => vote.vote === 'up').map(vote => vote.title).slice(0, MAX_EXAMPLES),
    refused: votes.filter(vote => vote.vote === 'down').map(vote => vote.title).slice(0, MAX_EXAMPLES),
});

// The sources whose cards were refused at least MIN_REFUSED times and at least twice as often as
// liked. A card is blamed on every source that brought one of its articles, except the kept ones:
// the shared feeds of everybody and the ones the reader added by hand, their choice stays. So only
// sources found for the profile are left out, and still once the discovery replaced them
export const refusedSources = (votes, kept) => refusedCounts(votes, kept).map(({url}) => url);

// the same with what the reader said of each: [{url, refused, liked}], the most refused first
export const refusedCounts = (votes, kept) => {
    const keep = new Set(kept);
    const counts = new Map();
    for (const vote of votes) {
        if (vote.vote !== 'up' && vote.vote !== 'down') continue;
        for (const url of new Set(vote.feedUrls ?? [])) {
            if (keep.has(url)) continue;
            const count = counts.get(url) ?? {up: 0, down: 0};
            count[vote.vote]++;
            counts.set(url, count);
        }
    }
    return [...counts]
        .filter(([, {up, down}]) => down >= MIN_REFUSED && down >= 2 * up)
        .map(([url, {up, down}]) => ({url, refused: down, liked: up}))
        .sort((a, b) => b.refused - a.refused);
};
