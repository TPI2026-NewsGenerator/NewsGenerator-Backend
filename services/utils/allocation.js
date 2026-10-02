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

// The searches of an interest asked to Media Cloud: both of the language of the reader and of English,
// the first one only of the others. It answers 2 searches a minute; measured on 5 profiles
// (bench/mc-one-search.mjs), one search per language halved the queue (27 to 13 minutes) but lost 2
// media of 13, all of them found by the second search in French or English; the other languages lost
// none. searches: [{lang, q}] in their order
export const pressSearches = (searches, readerLanguage) => {
    const seen = new Set();
    return searches.filter(({lang}) => {
        const first = !seen.has(lang);
        seen.add(lang);
        return first || lang === readerLanguage || lang === 'en';
    });
};

// The media named for an interest tried language by language, each in its order, a wave at a time,
// until enough of them gave a feed on the subject or enough were tried: taken all together, the six
// first of a reader of French and English were English (Google News answers up to 100 news in English,
// 11 to 77 in French) or had no feed (ign, imdb, pokemon.com), and margxt.fr, 10 news in 10 on
// the Pokémon cards, came 9th. A medium without a feed does not take the place of a kept one.
// media: [{site, lang, ...}] the most present first; tryOne(medium) answers the feed kept, or null
export const tryPerLanguage = async (media, tryOne, {kept = 2, tried = 5, wave = 3} = {}) => {
    const byLanguage = Map.groupBy(media, medium => medium.lang);
    const found = [];

    for (const candidates of byLanguage.values()) {
        const queue = candidates.slice(0, tried);
        let keptHere = 0;
        while (keptHere < kept && queue.length > 0) {
            const feeds = await Promise.all(queue.splice(0, wave).map(tryOne));
            for (const feed of feeds.filter(Boolean)) {
                if (keptHere === kept) break;
                found.push(feed);
                keptHere++;
            }
        }
    }
    return found;
};

// The feeds found for a profile that bring nothing on it any more: none of their news of the last
// days is on one of its interests. A feed just found is given the time to show it, unless it already
// published enough news to say so; a feed the reader kept stays.
// rows: [{id, url, created_at, news, relevant}] (see ProfileModel.profileFeedRelevance)
export const staleFeeds = (rows, {now = Date.now(), graceDays, minNews, kept = []}) => rows.filter(row =>
    row.relevant === 0
    && !kept.includes(row.url)
    && (now - new Date(row.created_at).getTime() >= graceDays * 24 * 3600e3 || row.news >= minNews));
