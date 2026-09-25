//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: allocation.js
//  Description: The feeds found for a profile shared between its interests (the stories are ranked
//               in the database, see rank_stories in db/add_briefing.sql). Pure.
//

"use strict"

// The feeds kept, as many as there is room for, taken in turn from each interest (its best feed
// first): a profile of rugby and fashion must not get twenty fashion feeds.
export const allocate = (perInterest, room) => {
    const queues = perInterest.map(feeds => [...feeds].sort((a, b) => b.score - a.score));
    const kept = [];
    const urls = new Set();

    while (kept.length < room && queues.some(queue => queue.length > 0)) {
        for (const queue of queues) {
            const feed = queue.shift();
            if (!feed || urls.has(feed.url)) continue;
            kept.push(feed);
            urls.add(feed.url);
            if (kept.length === room) break;
        }
    }
    return kept;
};
