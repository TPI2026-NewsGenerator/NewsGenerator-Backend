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
// refresh with thousands of feeds
export const MAX_USER_FEEDS = 100;          // added by hand, or from the suggestions
// the ones found for the profile have their own room: a user who had added 20 sources by hand got
// none for their profile, silently. They pile up discovery after discovery, and a source that brings
// nothing on the profile any more is removed (see DiscoveryService.prune)
export const MAX_PROFILE_FEEDS = 60;
export const MAX_NEW_PROFILE_FEEDS = 20;    // found by one discovery
// A site without a feed is read through our RSS-Bridge, which loads its page every time: those
// cost far more than a feed, and the bridge is shared by every reader
export const MAX_BRIDGE_FEEDS = 15;

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
