//
//  Author: Fabian Rostello
//  Date: 16.10.2026
//  File: kept-result.js
//  Description: A result read once, then read again in the background every few minutes: no request
//               waits for it any more
//

"use strict"

// The counts over days of the news are slow to read, the news one per page of 8 KB: 0.8 s each for the
// profile page, all the rest of it 30 ms (16.10.2026). kept = keptResult(read, {minutes}), then
// kept(key, version, ...args): the result of read(...args) of this key, as read at most 'minutes' ago.
// A key asked with another version (what the result depends on changed) is read again at once; a key
// not asked for 'forgetDays' is forgotten. A read that fails keeps the result before it
export const keptResult = (read, {minutes, forgetDays = 7}) => {
    const entries = new Map();          // key -> {version, args, askedAt, value: Promise}
    let timer = null;
    let refreshing = false;

    const load = (key, version, args) => {
        const entry = {version, args, askedAt: Date.now(), value: read(...args)};
        entries.set(key, entry);
        // not kept: the next request reads it again
        entry.value.catch(() => entries.get(key) === entry && entries.delete(key));
        return entry.value;
    };

    // one key after the other, not to load the database
    const refresh = async () => {
        if (refreshing) return;
        refreshing = true;
        try {
            for (const [key, entry] of entries) {
                if (Date.now() - entry.askedAt > forgetDays * 24 * 3600e3) {
                    entries.delete(key);
                    continue;
                }
                try {
                    const value = await read(...entry.args);
                    if (entries.get(key) === entry) entry.value = Promise.resolve(value);
                } catch (error) {
                    console.error(`Kept result ${key} not read again (${error.message ?? error})`);
                }
            }
        } finally {
            refreshing = false;
        }
    };

    return (key, version, ...args) => {
        if (!timer) {
            timer = setInterval(refresh, minutes * 60e3);
            timer.unref?.();
        }
        const entry = entries.get(key);
        if (entry && entry.version === version) {
            entry.askedAt = Date.now();
            return entry.value;
        }
        return load(key, version, args);
    };
};
