//
//  Author: Fabian Rostello
//  Date: 06.11.2026
//  File: watch-names.js
//  Description: The names the news of an item the profile follows are searched by: the ones of Wikidata, with the ones the reader
//               added and without the ones they took out, and the ones of them that are no search for a person (a family name that
//               many people carry). Apart from entity-service.js so that the tests of the corpus read it without a database
//

"use strict"

import {mentionKey} from './mentions.js';

// a name is searched as an exact phrase (see Filter.parse): its quotes and commas would cut it
export const cleanName = (name) => String(name ?? '').replace(/["“”,]/g, ' ').replace(/\s+/g, ' ').trim();

// the names its news are found by for this profile: the ones of Wikidata, with the ones its reader
// added and without the ones they took out
export const namesFor = (row, following) => {
    const removed = new Set((following?.removed_names ?? []).map(name => name.toLowerCase()));
    const seen = new Set();
    return [...row.names, ...(following?.added_names ?? [])].map(cleanName).filter(name => {
        const key = name.toLowerCase();
        if (name.length < 2 || removed.has(key) || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

// The names the news of an item are searched by. A family name or a first name alone is the name of everyone who carries it: the
// Wikidata aliases of Carlos Velasco Carballo (a Spanish referee) hold "Velasco", which found footballers, ministers and
// governors named Velasco in his tab: 73 sightings of the name, none linked to him (the user's friend, 6.11.2026). A person with a
// name of several words is searched by the names of several words, and by the item the tagger links its news to, without the
// one-word names that 'common' holds (the keys of the names, see commonNames of entity-service.js): the words alone the reader
// added stay. A name that belongs to few people stays (Čeferin: 259 news of the month, all of the president of UEFA)
export const searchNamesFor = (row, following, common = new Set()) => {
    const names = namesFor(row, following);
    if (row.kind !== 'person' || !/\s/.test(String(row.label ?? '').trim())) return names;
    const added = new Set((following?.added_names ?? []).map(name => cleanName(name).toLowerCase()));
    return names.filter(name => /\s/.test(name) || added.has(name.toLowerCase()) || !common.has(mentionKey(name)));
};
