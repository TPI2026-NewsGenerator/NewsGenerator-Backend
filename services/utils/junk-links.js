//
//  Author: Fabian Rostello
//  Date: 13.11.2026
//  File: junk-links.js
//  Description: The pages a feed can give that are not news. A wiki shows its edits as a feed (the recent changes of the Greek Wikipedia, the history of a page): every item is a
//               revision, a comparison of two versions, or the page of a user. One such feed gave 29 289 items in 30 days (965 a day, 0.6% of the news), 20 513 of them grouped into stories,
//               and a card of a briefing (13.11.2026, "National League (English football)": a comparison of two versions of the page, no picture, no news). Three rules use this: the
//               refresh of the feeds leaves such a link out, and neither the discovery of the sources, the directory nor the suggestions offer a feed of the edits of a wiki.
//               Wikinews is not concerned: it is news. The pages of a wiki that are articles (/wiki/FIFA) are not either. Pure
//

"use strict"

// the wikis of the Wikimedia family that are no news (Wikinews is left out)
const WIKI_HOST = /(^|\.)(wikipedia|wiktionary|wikibooks|wikiquote|wikisource|wikiversity|wikivoyage|wikimedia|mediawiki)\.org$/i;

const parsed = (value) => {
    try {
        return new URL(String(value));
    } catch {
        return null;
    }
};
const decoded = (text) => {
    try {
        return decodeURIComponent(text);
    } catch {
        return text;
    }
};
// a title of a page that begins with a namespace ("User:Name", "Χρήστης:Name", "Special:RecentChanges"): the colon is followed at once by a letter; in a title with a subtitle it is
// followed by a space ("Star Wars: Episode I", in an address "Star_Wars:_Episode_I")
const inNamespace = (title) => /^[^:]+:[^_:\s]/u.test(decoded(title).replace(/ /g, '_'));

// The link of a news that is a page of the edits of a wiki: a comparison or a version of a page (index.php with diff, oldid or an action), a special page or the page of a namespace (a user, a
// talk, a file), whatever the language of the wiki. false for an article, and for any address that is not a wiki of the family
export const isWikiEditLink = (link) => {
    const url = parsed(link);
    if (!url || !WIKI_HOST.test(url.hostname)) return false;
    const path = decoded(url.pathname);
    if (/\/index\.php$/i.test(path)) {
        const query = url.searchParams;
        return query.has('diff') || query.has('oldid') || query.has('action') || inNamespace(query.get('title') ?? '');
    }
    const title = path.match(/^\/wiki\/(.+)$/i)?.[1];
    return Boolean(title) && inNamespace(title);
};

// The address of a feed of the edits of a wiki (the recent changes, the history of a page, the new pages): an index.php or an api.php of a wiki of the family that asks for a feed
export const isWikiEditFeed = (url) => {
    const address = parsed(url);
    if (!address || !WIKI_HOST.test(address.hostname)) return false;
    const path = decoded(address.pathname);
    if (/\/index\.php$/i.test(path)) return address.searchParams.has('feed');
    if (/\/api\.php$/i.test(path)) return /^feed/i.test(address.searchParams.get('action') ?? '');
    return false;
};
