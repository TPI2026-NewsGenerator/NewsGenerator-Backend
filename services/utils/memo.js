//
//  Author: Fabian Rostello
//  Date: 02.11.2026
//  File: memo.js
//  Description: A small memory of answers, kept for a time, the oldest forgotten past a number: what Wikidata
//               told of a name is asked again by a reader who imports the same list twice, or by a client that
//               carries on after a pause
//

"use strict"

// ttlMs: how long an answer is kept; max: how many
export const memo = ({ttlMs, max}) => {
    const kept = new Map();
    return {
        // undefined when not kept, or kept too long
        get: (key) => {
            const found = kept.get(key);
            if (!found) return undefined;
            if (Date.now() - found.at >= ttlMs) {
                kept.delete(key);
                return undefined;
            }
            return found.value;
        },
        set: (key, value) => {
            kept.delete(key);
            kept.set(key, {at: Date.now(), value});
            while (kept.size > max) kept.delete(kept.keys().next().value);
        },
        clear: () => kept.clear(),
        size: () => kept.size,
    };
};
