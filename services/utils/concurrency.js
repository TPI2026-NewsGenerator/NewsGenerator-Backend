//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: concurrency.js
//  Description: Run async tasks in parallel with a limit
//

"use strict"

// run 'task' on every item with at most 'concurrency' tasks running at the same time
// returns one result per item, in the same order, like Promise.allSettled
export const mapWithConcurrency = async (items, concurrency, task) => {
    const results = new Array(items.length);
    let next = 0;

    const worker = async () => {
        while (next < items.length) {
            const index = next++;
            try {
                results[index] = { status: 'fulfilled', value: await task(items[index]) };
            } catch (err) {
                results[index] = { status: 'rejected', reason: err };
            }
        }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
    return results;
};
