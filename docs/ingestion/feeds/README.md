# Ingestion > Feeds

Every minute the server reads the feeds that are due, and stores their new news in `articles`. Nobody waits
for it: the searches and the briefings read what is already stored. A feed is read more often the more news it
gives, less often when it fails, and a news the server already has, or one older than the 30 days kept, is not
saved.

## Where

- No page and no route: background work, started by `server.js` (`IngestService.schedule()`), unless
  `INGEST_IN_SERVER=false`.
- `pnpm run ingest` (`scripts/ingest.js`) makes one run by hand; `pnpm run ingest:status` says where it stands.
- Other features ask for a run of some feeds: the discovery of a profile's sources and the sources added by
  hand (`IngestService.run({urls})`, from `services/discovery-service.js` and `controllers/feed-controller.js`),
  and a search that asks Google News a sentence (`IngestService.readNow(urls)`, `services/news-service.js`).

## How it works

- **The lock.** `IngestService.run` (`services/ingest-service.js`) takes `pg_try_advisory_lock(hashtext('newsgenerator-ingest'))`
  on a connection of its own. Another run holds it: the run is skipped; a run asked for some feeds reads them
  anyway, and the run at work gives them their vectors.
- **Which feeds.** The feeds of `db/rss-links.js`, of the directory (`DirectoryModel.all()`) and of every
  reader (`FeedModel.allUserFeedUrls()`). `FeedModel.feedRhythms` counts the news each gave in the last 24 h,
  and `feedsDue` keeps those never read or read longer ago than `readEvery`: 72 news and more every 2 min,
  24 to 71 every 5, 6 to 23 every 15, 1 to 5 every 30, none every 60.
- **Failures.** A failing feed is read twice less often per failure in a row (`feeds.failures`), every hour at
  most; once a day when its last success (`last_success_at`) is 3 days old or more (`FAILING_DAYS`).
- **Google News.** The searches the AI wrote for the interests (`ProfileModel.searchesOf`, `interestSearchUrls`,
  2 days each) are read every `GOOGLE_NEWS_EVERY_MINUTES` (60), 60 per run at most (`FeedModel.dueFeeds`),
  not at all with `GOOGLE_NEWS=off` or while Google is paused. They go through one queue for every request of
  the server to Google, 1 s apart (`GOOGLE_NEWS_INTERVAL_MS`); a 429, a 503 or a captcha pauses the searches
  for an hour, and the searches left answer `{skipped}`: read at the next run.
- **The read.** `FeedService.refreshUrls` (`services/feed-service.js`) gives each url a row in `feeds`
  (`syncFeeds`), then reads the feeds with `Crawlers.Xml` (`services/utils/crawlers.js`), 50 at a time, 8 s
  each, 40 s through RSS-Bridge, with the `etag` and `last_modified` of the last read: an unchanged feed
  answers 304. The same group of feeds is never read twice at the same time (the `running` map).
- **What is saved.** Each feed gets `last_error` and `failures + 1`, or its new `etag`, `last_success_at`
  and `failures = 0`. An item without link or title is skipped, one published before the retention
  (`FEED_RETENTION_DAYS`, 30) too: some feeds give their whole archive. So is a link over 2000 bytes (counted
  in bytes, an accented link is longer than it looks): the unique index `(id_feed, link)` of the articles takes
  2704 bytes at most, and a tracking link of 3600 made the whole `createMany` of a run fail on 20.10.2026, the
  news of every feed read with it lost. The ones skipped are counted in the stats of the refresh (`longLinks`). `FeedModel.withoutRepeats` drops a news
  its feed gave already under another link (same feed, title and date of publication, index
  `i_articles_feed_published`, `db/add_article_repeats.sql`), then `insertArticles` inserts 1000 rows a
  statement, a link once per feed. The news of Google News keep their publisher in `source_url`.
- **Retention.** Once an hour (`HOUSEKEEPING_MINUTES`) the run purges: `deleteArticlesOlderThan` (30 days,
  by `created_at`), then the empty stories and threads.
- **The floods.** A feed of 500 news a day or more (`isFlood`, `services/utils/feed-limits.js`) is read like
  the others; its news get their vectors last (see [Vectors](../vectors/README.md)).
- **Next run.** `INGEST_INTERVAL_MINUTES` (1) after the start of this one, at once when it worked longer.

## Measured

- All the feeds read every 20 minutes, a news waited 19 minutes in the median to be read and 28 to have its
  vectors; every feed read every minute would be 24 requests a second. With the rhythms: 220 requests a
  minute (77 before), the 200 feeds giving two thirds of the news read every 2 minutes ([the former README](../../archive/readme-features-2026-10-24.md)).
- Repeats: 7,734 news given again under another link in one day in 297 feeds (agenzianova.com: 1,088 news
  a day stored 7,440 times), 5.10.2026 (`models/feed-model.js`).
- Archives: americansoccernow.com since 2012, irishfa.com since 2006, 12,400 news stored at their first read
  on 8.10.2026 before the date limit (`services/feed-service.js`).
- RSS-Bridge: 1 to 12 s a build, 3 KB to 1.4 MB, measured on 10 sites (1.10.2026).

## Diagrams

- [Class diagram](ingestion-feeds-class.png) ([source](ingestion-feeds-class.puml))
- [Sequence diagram](ingestion-feeds-sequence.png) ([source](ingestion-feeds-sequence.puml))
- The whole ingestion: [04-ingestion](../04-ingestion.png), [24-ingestion-sequence](../24-ingestion-sequence.png)

## See also

- [Vectors](../vectors/README.md): what happens to the news saved here, in the same run.
- [Directory](../directory/README.md): the feeds the server adds itself, read here.
- [Sources > Discovery](../../sources/discovery/README.md) and [Sources > Added by hand](../../sources/added-by-hand/README.md): the runs asked for some feeds.
