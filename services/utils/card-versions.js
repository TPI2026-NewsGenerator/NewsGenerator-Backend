//
//  Author: Fabian Rostello
//  Date: 09.11.2026
//  File: card-versions.js
//  Description: The same news in the briefings of two profiles of one account is the same story, but not always the same card: each
//               profile reads it from the articles of its own sources and writes it with its own lead article, picture and points.
//               A reader who finds one written better (the user's friend, 9.11.2026: the Wenger news of one profile was better than the
//               other's) takes that version into the briefing he reads: the card is replaced where it stands, still the card of its
//               story (its other media, its follow-ups, its thumb), and the version he had comes back with one click
//

"use strict"

// the briefings of the other profiles looked at: of the last days only, their news are of the day
export const VERSION_DAYS = 7;

// the story of a card and the stories merged into it: the same news is any of them in the other briefing
export const idsOf = (card) => [card?.storyId, ...(card?.mergedStoryIds ?? [])].filter(id => Number.isInteger(id) && id > 0);

// What belongs to the briefing the card is in, and to the profile it was written for, not to the version of its news: its story and the
// ones merged into it, why it was chosen, for which interest and project, whether it follows a card of the last days, the thumb of the
// reader, the feeds a refusal is blamed on, the mark of an e-mail sent. Kept when the card is replaced
const OF_THE_BRIEFING = ['storyId', 'mergedStoryIds', 'why', 'interest', 'project', 'followUp', 'vote', 'votedAt', 'feedUrls', 'sentAt'];
// What a version of another profile brings that is not carried: the edits of the reader of the other briefing for its e-mail, the places
// of the terms its profile follows (marked again for this one when the page reads it), the marks of a card added or replaced
const NOT_CARRIED = ['ownTitle', 'ownText', 'marks', 'found', 'analysis', 'imported', 'transferred', 'version', 'previousVersion'];

const only = (card, keys) => Object.fromEntries(keys.filter(key => card && key in card).map(key => [key, card[key]]));

// The versions the other briefings have of the cards of this one: {storyId: [{briefingId, idProfile, createdAt, title, source}]}.
// items: the cards of the briefing, rows: what BriefingModel.versionsOf found, `usable(idProfile)` whether the profile of a row is another
// than this one's and reads in its language (its translations are of that language). A card with the same lead article is no other version, and
// one profile gives one version, the one of its newest briefing
export const versionsOfCards = (items, rows, usable = () => true) => {
    const versions = {};
    for (const item of items) {
        if (!(item.storyId > 0) || item.imported) continue;
        const own = new Set(idsOf(item));
        const found = rows.filter(row => row.leadUrl && row.leadUrl !== item.lead?.url && usable(row.idProfile)
            && idsOf({storyId: row.storyId, mergedStoryIds: row.mergedStoryIds}).some(id => own.has(id)));
        // the newest briefing of each profile: the same news is a card of each of its briefings of the week
        const newest = new Map();
        for (const row of found) {
            const kept = newest.get(row.idProfile);
            if (!kept || new Date(row.createdAt) > new Date(kept.createdAt)) newest.set(row.idProfile, row);
        }
        if (newest.size > 0) {
            versions[item.storyId] = [...newest.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .map(({briefingId, idProfile, createdAt, title, source}) => ({briefingId, idProfile, createdAt, title, source}));
        }
    }
    return versions;
};

// The card of this briefing replaced by the one of another: everything of the version of the other (its lead article, title, picture,
// passages, points, AI version, other media, official sources, names, countries), what belongs to this briefing kept. 'from':
// {briefingId, idProfile, profile, createdAt} says where it comes from; the card it replaces is kept in 'previousVersion' with its
// analysis lines, for the way back. Replaced twice, the way back is still the first card: the one this profile wrote
export const swappedCard = (current, other, from, currentLines = null) => {
    const {previousVersion, ...own} = current;
    const carried = Object.fromEntries(Object.entries(other).filter(([key]) => !OF_THE_BRIEFING.includes(key) && !NOT_CARRIED.includes(key)));
    return {
        ...carried,
        ...only(current, OF_THE_BRIEFING),
        version: {briefingId: from.briefingId, idProfile: from.idProfile ?? null, profile: from.profile ?? null, createdAt: from.createdAt ?? null},
        previousVersion: previousVersion ?? {card: own, lines: currentLines},
    };
};

// The card as this profile wrote it, back, with what changed on it since (the thumb, the mark of an e-mail sent); null for a card that
// was never replaced
export const restoredCard = (current) => current?.previousVersion
    ? {...current.previousVersion.card, ...only(current, OF_THE_BRIEFING)}
    : null;

// The card as the page gets it: the card it replaced stays on the server (it is the way back), the page is told only which one it was
// (its title and its medium), a card is some tens of kilobytes
export const forThePage = (card) => card?.previousVersion
    ? {...card, previousVersion: {title: card.previousVersion.card?.title ?? null, source: card.previousVersion.card?.lead?.source ?? null}}
    : card;
