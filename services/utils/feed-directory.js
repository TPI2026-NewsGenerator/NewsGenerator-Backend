//
//  Author: Fabian Rostello
//  Date: 23.09.2026
//  File: feed-directory.js
//  Description: Directory of feeds, to find a feed a site declares nowhere and to search by subject
//

"use strict"

import {discardBody} from "./public-url.js";

// Feedly indexes the feeds people subscribe to, so it knows the ones a site declares nowhere and
// that are on no usual path: football.london and uefa.com are found here and by nothing else.
// It answers without a key, but this is not a documented endpoint: it can close any day, so a
// failure is never an error here, only an empty answer. What it returns is checked like anything
// else before being fetched (see checkFeeds and FeedController.importSources), its index is stale
// in places.
const SEARCH_URL = 'https://cloud.feedly.com/v3/search/feeds';
const TIMEOUT_MS = 8000;

// how many people read this feed: the only quality signal we get for free
const toFeed = (result) => ({
    url: String(result.feedId ?? '').replace(/^feed\//, ''),
    title: result.title ?? '',
    site: result.website ?? '',
    language: result.language ?? null,
    subscribers: result.subscribers ?? 0,
});

// feeds matching a site ("uefa.com") or a subject ("premier league"), the most read first
export const searchDirectory = async (query, count = 20) => {
    const url = `${SEARCH_URL}?query=${encodeURIComponent(query)}&count=${count}`;

    try {
        const res = await fetch(url, {signal: AbortSignal.timeout(TIMEOUT_MS)});
        if (!res.ok) {
            await discardBody(res);
            return [];
        }

        const {results} = await res.json();

        return (results ?? [])
            .map(toFeed)
            .filter(feed => feed.url.startsWith('http'))
            .sort((a, b) => b.subscribers - a.subscribers);
    } catch {
        return [];      // the directory is a bonus, a search must never fail because of it
    }
};
