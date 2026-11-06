//
//  Author: Fabian Rostello
//  Date: 06.11.2026
//  File: preferences.js
//  Description: What the display preferences of a reader can be, kept on their account so that their phone and their laptop show the same
//               (the user, 06.11.2026): the layout of the editor of the e-mail, the presets of the e-mail and of the page, the preset the page
//               shows, the way a card is read, the size of the next briefing and the news per name followed. Only these keys, each with only
//               the values the page offers: the column is a JSON the page writes, so nothing else is let in
//

"use strict"

import {Buffer} from 'node:buffer';
import {BRIEFING_SIZES} from './profile-ai.js';

// the whole body of a save, in bytes: the biggest one (both presets, every block of every list) is about 1 200
export const MAX_PREFERENCES_BYTES = 4096;

const LAYOUTS = ['frames', 'matrix'];
const PRESET_NAMES = ['short', 'standard', 'everything'];
const WAYS = ['points', 'digest', 'passages'];
// as BLOCKS of mailBlocks.js on the client: the picture and the countries, then the blocks the e-mail takes (BLOCKS of briefing-service.js)
const BLOCKS = ['picture', 'countries', 'media', 'contested', 'official', 'unconfirmed', 'names', 'analysis', 'angles', 'affair', 'coverage'];
// as WATCH_LIMITS of briefing-service.js
const FOLLOWING_NEWS = Array.from({length: 10}, (_, i) => (i + 1) * 10);

const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// {preset: [block]}: only the presets there are, each a list of blocks there are, none twice (the page sends the ones in order)
const presetsOf = (value) => plain(value) && Object.keys(value).length > 0
    && Object.entries(value).every(([name, blocks]) => PRESET_NAMES.includes(name) && Array.isArray(blocks)
        && new Set(blocks).size === blocks.length && blocks.every(block => BLOCKS.includes(block)));

// key: what the page calls it; accepts(value): whether the page could have chosen it; rule: what is said when it did not
export const PREFERENCES = {
    layout: {accepts: (value) => LAYOUTS.includes(value), rule: `one of ${LAYOUTS.join(', ')}`},
    mailPresets: {accepts: presetsOf, rule: `{${PRESET_NAMES.join(', ')}} each a list of the blocks ${BLOCKS.join(', ')}`},
    pagePresets: {accepts: presetsOf, rule: `{${PRESET_NAMES.join(', ')}} each a list of the blocks ${BLOCKS.join(', ')}`},
    show: {accepts: (value) => PRESET_NAMES.includes(value), rule: `one of ${PRESET_NAMES.join(', ')}`},
    format: {accepts: (value) => WAYS.includes(value), rule: `one of ${WAYS.join(', ')}`},
    size: {accepts: (value) => BRIEFING_SIZES.includes(value), rule: `one of ${BRIEFING_SIZES.join(', ')}`},
    followingNews: {accepts: (value) => FOLLOWING_NEWS.includes(value), rule: `one of ${FOLLOWING_NEWS.join(', ')}`},
};

const refuse = (status, message) => Object.assign(new Error(message), {status});

// The preferences to save from the body of a request: the keys it sends, as they are, or a refusal (400, 413). Nothing is dropped
// quietly: a key or a value the page does not know is a request that did not come from it
export const checkedPreferences = (body) => {
    if (!plain(body)) throw refuse(400, 'Send the preferences to save as an object.');
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_PREFERENCES_BYTES) throw refuse(413, `The preferences are over ${MAX_PREFERENCES_BYTES} bytes.`);

    const keys = Object.keys(body);
    if (keys.length === 0) throw refuse(400, 'Send at least one preference to save.');
    for (const key of keys) {
        if (!Object.hasOwn(PREFERENCES, key)) throw refuse(400, `${key} is not a preference. They are ${Object.keys(PREFERENCES).join(', ')}.`);
        if (!PREFERENCES[key].accepts(body[key])) throw refuse(400, `${key}: ${PREFERENCES[key].rule}.`);
    }
    return body;
};
