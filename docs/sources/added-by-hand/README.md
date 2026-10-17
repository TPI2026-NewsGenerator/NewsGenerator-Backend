# Sources > Added by hand

The reader adds sources of their own to a profile: a website (the server finds its feed), the results
of a search of the Feedly directory and of the web, or a whole list of sites from a file of theirs. Each
feed is read before it is added, a site with no feed is read through our RSS-Bridge, and what is added is
read at once instead of waiting for the next run of the ingestion. Sources added by hand are never removed
by the server.

## Where

- Client: `client/src/features/briefing/components/AddSources.jsx` ("Add a website", "Or search a site, a
  feed or a subject") and `ImportSources.jsx` ("Import a list"), with `client/src/features/briefing/importFile.js`,
  in the section "Add sources" of `client/src/pages/Profile.jsx`; `FeedApi` in
  `client/src/features/search/api/feedApi.js`.
- API (`routes/feed-router.js`, after `authenticateToken` and `activeProfile`): `POST /api/feeds`
  `{site, category, language}` (and `needsProfile`), `POST /api/feeds/search` `{query, language, from}`,
  `POST /api/feeds/check` `{sites, language}` (and two rate limits), `POST /api/feeds/import`
  `{sources, language, subject}` (and `needsProfile`). `controllers/feed-controller.js`,
  `services/source-service.js`.

## How it works

- **A website** (`FeedController.addUserFeed`): category among `FeedService.categories()` (400 otherwise),
  800 sources by hand at most (`MAX_USER_FEEDS`). `findFeeds(site, {language})`
  (`services/utils/feed-finder.js`) reads the page through `fetchPublicUrl` (a public address only, each of
  3 redirects checked; `services/utils/public-url.js`): the feeds it declares (comments feeds aside), else 13
  usual paths (`/rss`, `/feed`, the Arc and Reach ones…). Each candidate is read; the one with
  the most news of the last 7 days wins. None: the feeds Feedly knows for this same medium, then its news
  sitemap (`newsSitemaps`, 4 at most), then RSS-Bridge. A page that answers an error: its root is tried.
  The feed is added (`user_feeds`, `origin 'user'`, the language told by its news) and read now
  (`IngestService.run`); the answer carries a sample title.
- **RSS-Bridge** (`services/utils/feed-bridge.js`, only when `RSS_BRIDGE_URL` is set): the page read, the
  prefixes of its article links ranked (the subject's section, then a news section, then the reader's
  language, then the most links; legal, contact, shop… left out), 3 tried with `CssSelectorBridge`, 15
  articles asked. Kept only with 3 articles, titles of 12 characters, half of them dated. 50 such sites per
  profile (`MAX_BRIDGE_FEEDS`, `bridgeRoom`). The address of the bridge never leaves the server
  (`forClient` sends `url: null` and a `key`); a user naming it is refused.
- **A search** (`POST /feeds/search`): the page asks both at once. `from: 'directory'` (`searchDirectory`,
  about 1 s): Feedly's search (`services/utils/feed-directory.js`, no key, an undocumented endpoint: a
  failure is an empty answer, 8 s timeout), 15 results, the media the profile already reads left out
  (`knownMedia`). `from: 'web'` (`searchWeb`, 20 to 45 s): the work of [Missing sources](../missing-sources/README.md)
  over 30 days; Google News refusing gives no result, not an error. The ones ticked go to `/feeds/import`
  with `subject` when they came from the web.
- **A file**: read in the browser (`addressesOfFile`): `.xlsx`/`.xlsm` (its cells and their links), CSV,
  OPML (the feed of each outline), any text; 1000 addresses at most (`MAX_SITES`), the feed of a line
  rather than its site. Then `POST /feeds/check` 25 at a time (`MAX_CHECKED_SITES`): `checkSites` runs
  `findFeeds` on 6 sites at once, 60 s each, and gives each a status — `ready`, `bridge`, `asleep` (fewer
  than 3 news in 7 days), `flood` (over 300 items at once, `MAX_FEED_ITEMS`), `added`, `none`. Over 2000
  sites an hour per account or 4000 per address: 429 with `retryAfter`, the page offers to check the others
  later. Only `ready` ones are ticked; the reader adds them 50 at a time.
- **Import** (`importSources`, the same for the search, the file and Missing sources): what the client sends
  is never trusted. Each feed sent is read once (`Crawlers.Xml`, through `fetchPublicUrl`); a dead or empty
  one is refused with its reason. A source sent without an address (a site read from its page) has its feed
  found again by the server from its name, on the `subject` when given. Then `assertPublicUrl`, the room
  (800, 50 on the bridge), `addUserFeed`; `{feeds, errors}` with one error per source refused; the ones
  added read at once.
- **Afterwards**: the sources added are listed by `SourceList` as "added by you"; `DELETE /feeds/:id` removes
  one. Every reader's sources are read for every reader (since 8.10.2026), those whose address may hold a
  key aside (`looksPrivate`).

## Measured

- Limits (`services/utils/feed-limits.js`): 150 sources at first; a reader's list of 865 football sources
  gave 510 feeds beyond 364 already there, hence 800. RSS-Bridge on 10 sites (1.10.2026): 1 to 12 s a build,
  3 KB to 1.4 MB, kept an hour by the bridge; 50 sites are about 50 builds an hour. A feed of 300 items:
  of 1231 feeds read on 1.10.2026, half held 24 news at most, 99% 256.
- News sitemaps: 9 of 40 media the directory found without a feed publish one (`bench/news-sitemaps.mjs`).
- A dead address of a list: 91 of 855 answered 404, the site itself still had a feed (17) or a page to
  read (28) (`feed-finder.js`). A list of 495 sites took about 4 minutes, 6 at a time (`checkSites`).

## Diagrams

- [Class diagram](sources-added-by-hand-class.png) ([source](sources-added-by-hand-class.puml))
- [Sequence diagram](sources-added-by-hand-sequence.png) ([source](sources-added-by-hand-sequence.puml))
- Feature overview: [05-sources](../05-sources.png)

## See also

- [Missing sources](../missing-sources/README.md): the web search behind `from: 'web'`
- [Recommended](../recommended/README.md): sources of other readers, added by their id
- [Trusted and thumbs](../trusted-and-thumbs/README.md): the star, removing a source
- [Ingestion > Feeds](../../ingestion/feeds/README.md): how the feeds are read after
