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
  2500 sources by hand at most (`MAX_USER_FEEDS`, per profile). `findFeeds(site, {language})`
  (`services/utils/feed-finder.js`) reads the page through `fetchPublicUrl` (a public address only, each of
  3 redirects checked; `services/utils/public-url.js`): the feeds it declares (comments feeds aside), else 14
  usual paths (`/rss`, `/feed`, `/feed/`, the Arc and Reach ones…), built on the address the page ends on
  after its redirects, and tried too when none of the feeds it declares answers with news. Each candidate
  is read; the one with the most news of the last 7 days wins. When that feed has fewer than 3 news of the
  week, the usual paths and the feeds Feedly knows are read too and the best of all wins. None: the feeds
  Feedly knows for this same medium, then its news sitemap (`newsSitemaps`, 4 at most, its addresses read
  together), then RSS-Bridge. A page that answers an error: its root is tried; a bare domain whose page is
  refused: its `www.` page (the site is read there when it answers), and the usual paths of both.
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
- **A file**: read in the browser (`openFile`, `client/src/features/briefing/importFile.js`): `.xlsx`/`.xlsm`
  (its cells and their links), CSV, OPML (the feed of each outline), any text; 2000 addresses at most
  (`MAX_SITES`, what the server checks in an hour), the feed of a line rather than its site. An Excel file
  with several sheets or several columns of addresses is not read at once: the page asks which sheet and
  which column list the sites (`ImportSources`, the column holding the most addresses ticked first), or
  "All sheets" / "Every column" for the line-by-line reading above. The sheets are named by `workbook.xml`
  and the cells found whatever prefix the writer gave the namespace (`<x:row>` as well as `<row>`; a file
  of the first kind was read by its links only until 2.11.2026, every link of every column mixed).
  Then `POST /feeds/check` 25 at a time (`MAX_CHECKED_SITES`): `checkSites` runs
  `findFeeds` on 6 sites at once, 60 s each, and gives each a status — `ready`, `bridge`, `asleep` (fewer
  than 3 news in 7 days), `flood` (over 300 items at once, `MAX_FEED_ITEMS`), `added`, `none`. Over 2000
  sites an hour per account or 4000 per address: 429 with `retryAfter`, the page offers to check the others
  later. Only `ready` ones are ticked; the reader adds them 50 at a time.
- **Import** (`importSources`, the same for the search, the file and Missing sources): what the client sends
  is never trusted. Each feed sent is read once (`Crawlers.Xml`, through `fetchPublicUrl`); a dead or empty
  one is refused with its reason. A source sent without an address (a site read from its page) has its feed
  found again by the server from its name, on the `subject` when given. Then `assertPublicUrl`, the room
  (2500, 50 on the bridge), `addUserFeed`; `{feeds, errors}` with one error per source refused; the ones
  added read at once.
- **Afterwards**: the sources added are listed by `SourceList` as "added by you"; `DELETE /feeds/:id` removes
  one. Every reader's sources are read for every reader (since 8.10.2026), those whose address may hold a
  key aside (`looksPrivate`).
- **Which one to keep**: `GET /feeds` gives each source added by hand its `news` of the last 14 days that got
  vectors and how many are `relevant`, on an interest of the profile (`ProfileModel.profileFeedRelevance` with
  `origin: 'user'`, the level of the sources found for the profile). `SourceList` writes "126 of 1,064 news on
  your interests (11.8%)" (the sources found for the profile, which come with `news` since 2.11.2026, and the
  recommended ones say it the same way) and can sort by it, to choose between two feeds of one site or to see
  the ones that bring nothing; the route of each feed is under its name. Nothing is removed by it. The count is slow (49 s for
  640 k news of 1497 sources, 2.11.2026) so it is never waited for: `ProfileService.ownRelevance` reads it in
  the background, kept an hour (`keptResult`), and answers `relevance.ready: false` until it is there; the
  page asks again every 15 s, 12 times at most. agenzianova.com, two feeds of the profile of Enzo: 126 of 1064
  news on the interests for `/news/feed/`, 1403 of 13808 for `/rss/news`, and only 59 of the 126 are in the
  second (845 titles in both, with other addresses): the first brings 67 that the second does not carry.

## Measured

- Limits (`services/utils/feed-limits.js`): 150 sources at first; a reader's list of 865 football sources
  gave 510 feeds beyond 364 already there, hence 800; 2500 since 2.11.2026 for a list of 1553 sites. RSS-Bridge on 10 sites (1.10.2026): 1 to 12 s a build,
  3 KB to 1.4 MB, kept an hour by the bridge; 50 sites are about 50 builds an hour. A feed of 300 items:
  of 1231 feeds read on 1.10.2026, half held 24 news at most, 99% 256.
- News sitemaps: 9 of 40 media the directory found without a feed publish one (`bench/news-sitemaps.mjs`).
- The finder against the feeds a friend's list gives (2.11.2026, 437 sites of 211 football associations,
  `findFeeds` without the bridge, 6 at a time): the feed of the list found for 356 sites (81%) at first, 380
  (87%) with the fixes above; none at all for 46, then 29. Of the 29: 13 answer 403 to every address, with
  any browser; 5 answer 429; 1 answers 500; 2 are dead; 4 publish on an address no usual path names
  (`/stories/rss`, Feedburner); 2 have a feed that is empty, rightly left out; 2 are slow, sometimes 60 s,
  sometimes 2 s. Of the 78 sites where another feed is chosen, 71 have as many news of the week as the
  feed of the list or more, 3 a little less, and 1 far fewer: bbc.com/news, whose news feed is on
  feeds.bbci.co.uk, another host (6 news against 33).
- The slowness of a long list: the same 437 sites took 256 s with the 4 threads Node keeps for the lookups
  of names, 219 s with 32 (`UV_THREADPOOL_SIZE` of the Dockerfile; one run each). The news sitemaps read
  together took 0.15 to 1.0 s a site against 0.4 to 4.9 s one after the other (6 sites).
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
