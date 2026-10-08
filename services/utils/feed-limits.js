//
//  Author: Fabian Rostello
//  Date: 25.09.2026
//  File: feed-limits.js
//  Description: How many sources a reader can have, and the address of a source that must stay
//               private. Pure.
//

"use strict"

import {isBridgeUrl} from "./public-url.js";

// A feed read costs one conditional request every 20 minutes, and only its new news are embedded:
// a reader can add most of the media of their subjects. The limit only stops a user from filling the
// refresh with thousands of feeds. 150 at first: a reader's list of the football media of Europe had
// 180 feeds, about 500 news a day for the 108 the server did not read yet (a small share of what it reads).
// 500 next, then 800: a list of 865 football sources gave 510 feeds, beyond the 364 a reader had already
export const MAX_USER_FEEDS = 800;          // added by hand, from a file or from the suggestions
// the ones found for the profile have their own room: a user who had added 20 sources by hand got
// none for their profile, silently. They pile up discovery after discovery, and a source that brings
// nothing on the profile any more is removed (see DiscoveryService.prune)
export const MAX_PROFILE_FEEDS = 60;
export const MAX_NEW_PROFILE_FEEDS = 20;    // found by one discovery
// A site without a feed is read through our RSS-Bridge, which loads its page and up to 15 of its
// articles: those cost far more than a feed, and the bridge is shared by every reader. Measured on
// 2026-10-01 (10 sites): 1 to 12 s a build, 3 KB to 1.4 MB, and the bridge keeps it an hour, the reads
// of the next 20 minutes answer at once. 50 sites of a reader are about 50 builds an hour, 7 minutes
// of the bridge and 16 pages per site. 15 at first, a guess never measured
export const MAX_BRIDGE_FEEDS = 50;
// A feed holding more news at once is a flood or an archive, not a feed of news: gurufocus.com/rss.php
// held 3611 notes on stocks, 2539 of the last 48 h, an hour of the processor of the embedder. Of the
// 1231 feeds read on 2026-10-01 half held 24 news at most in a read, 99% 256. The directory refuses
// them; a reader importing a list is told, and decides
export const MAX_FEED_ITEMS = 300;

// A feed giving more news a day than this is a flood: its news get their vectors after the news of
// every other feed (see ingest-service.js), and the reader who added it is told. On 2026-10-05, of the
// 1817 feeds that gave news in 24 hours, half gave 20 at most, 90% 134, 99% 525; the 22 over 500 gave
// 25,317 of the 109,753 news, while the embedder does about 4,100 an hour: the news of 1817 feeds came
// late because agenzianova.com gave the same 1,088 news 7 times over (see FeedModel.withoutRepeats)
export const FLOOD_NEWS_PER_DAY = 500;
export const isFlood = (newsPerDay) => (newsPerDay ?? 0) >= FLOOD_NEWS_PER_DAY;

// how many feeds read through the bridge this reader can still get, among all their feeds
export const bridgeRoom = (urls) => Math.max(0, MAX_BRIDGE_FEEDS - urls.filter(isBridgeUrl).length);

// the feeds kept in order, without the ones read through the bridge once there is no room for them
export const withinBridgeRoom = (feeds, room) => {
    let left = room;
    return feeds.filter(feed => !isBridgeUrl(feed.url) || left-- > 0);
};

// names of the parameters that carry a key in the address of a private feed (a paid newsletter, a
// private podcast, a Patreon): "?key=", "?auth=", "?token="...
const SECRET_PARAMS = /^(key|api[-_]?key|auth|authorization|token|access[-_]?token|secret|sig|signature|password|passwd|pass|pwd|session|sid|private|uid|user|userid|login|email|hash)$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// a random key: long, letters and figures mixed, not the words of a slug ("transfer-news-2026")
const isKey = (value) => {
    if (UUID.test(value)) return true;
    if (value.length < 20 || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
    const figures = (value.match(/[0-9]/g) ?? []).length;
    const letters = (value.match(/[A-Za-z]/g) ?? []).length;
    const longest = Math.max(...value.split(/[-_]/).map(part => part.length));
    return figures >= 4 && letters >= 4 && longest >= 16;
};

// true when the address of a feed may hold a key of its reader: it is then never suggested to anybody
// else, even shared. The address of our RSS-Bridge is built by this server, it holds none
export const looksPrivate = (value) => {
    let url;
    try {
        url = new URL(value);
    } catch {
        return true;
    }
    if (isBridgeUrl(value)) return false;
    if (url.username || url.password) return true;
    for (const [name, param] of url.searchParams) {
        if (SECRET_PARAMS.test(name) || isKey(param)) return true;
    }
    // a part of the path without its extension: ".../3f2b9c1e-8a4d-...-7d1a5b8e0f34.xml"
    return url.pathname.split('/').some(part => isKey(part.replace(/\.[a-z0-9]{1,5}$/i, '')));
};
