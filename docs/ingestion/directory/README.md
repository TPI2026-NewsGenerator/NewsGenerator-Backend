# Ingestion > Directory

The server grows a directory of feeds of its own, read by every search and briefing of their language: the media
Google News names in the searches the server reads but no feed of ours reads, and the sections of the media
already read that bring the news their feeds miss. Once a day it takes out the feeds of the directory that serve
no reader, so that what it adds does not drown the grouping.

## Where

- No page: background work after the runs of `IngestService.schedule()` (`services/ingest-service.js`): `grow`
  every 20 minutes (`GROW_EVERY_MINUTES`), `prune` once a day (`PRUNE_EVERY_HOURS`), the first time after the
  first run of the server.
- `node scripts/grow-directory.js [named] [sections] [concurrency]` looks at every medium at once (1000, 1000,
  6 by default), the first time.
- Readers: `DirectoryModel.feedUrls` for the searches, `DirectoryModel.all()` for the runs of the ingestion
  (see [Feeds](../feeds/README.md)).

## How it works

- **Named media.** `DirectoryModel.namedMedia` takes the media named at least 3 times in 30 days by the news of
  the feeds of Google News the server read (the searches of the profiles and the sentences of the searches),
  that no feed every reader can search reads, not looked at for 30 days, the most named first,
  `DIRECTORY_PER_RUN` (10) of them. `tryNamed` asks `findFeeds` (`services/utils/feed-finder.js`) for the
  feeds of the site, without RSS-Bridge, and keeps the first one with 3 news of the last 7 days at least, in one
  of our languages told by its own news (`feedLanguage`), with no key in its address (`looksPrivate`), 300
  news at once at most (`MAX_FEED_ITEMS`), and no podcast (`isPodcast`: `<itunes:` or audio/video
  enclosures). It goes in no category.
- **Sections of the media read.** The media of `db/rss-links.js` (named by the news of their feeds,
  `mediaOfFeeds`) and the named media of the directory, 10 not looked at for 30 days. `siteFeeds` lists the
  feeds the site declares, lists on its page of feeds, or Feedly knows (`searchDirectory`), 20 at most;
  `readFeeds` reads them and `chooseSections` keeps the ones whose recent news (7 days) are mostly (half at
  least, 3 at least) news the medium's feeds miss (`linksOf`, 30 days), the best first, the news of the first
  counting as read for the next, 2 per medium. A section in a language not ours, a podcast, or one whose
  category (read in its address, `sectionCategory`: "/health/" is science) no interest follows is left out.
- **Saved.** 3 media at a time (`CONCURRENCY`). Each feed kept is checked against `directory_removed`
  (`stillRemoved`: taken out in the last 60 days, and no profile created or written since), then added to
  `directory_feeds` (`origin` named or section); each medium looked at is noted in `directory_tries` with what
  it gave and why not (`db/add_directory.sql`). The next run reads the new feeds. `DIRECTORY=off` stops it.
- **Pruned.** `prune` asks `DirectoryModel.readers(14)`: no ready briefing in 14 days, or no interest with a
  vector, and nothing is taken out. Else `DirectoryModel.usage` gives, per feed of the directory, its news of 3
  days with vectors, how many reach 0.45 (`JUDGE_THRESHOLD`, `meaning-judge.js`) with the dense vector of any
  interest, and whether a ready briefing of 14 days showed a news of its medium read through the directory.
  `uselessFeeds`: a feed used stays; one younger than 14 days stays unless it gave 300 news in 3 days; a section
  of a category nobody follows goes, and so does a feed with news under 11% of them on an interest
  (`MIN_ON_INTERESTS`). `remove` moves them to `directory_removed` with the reason, in one transaction
  (`db/add_directory_removed.sql`); their news stay until the retention. `DIRECTORY_PRUNE=off` stops it.

## Measured

- Google News against our feeds (`bench/vs-google.mjs`, 15 sentences over 7 days, its first 30 news judged by
  hand): 76% of its news were in no feed of ours, a third from media we read, two thirds from others.
- First grow (30.09.2026): 601 media named, 316 main feeds kept; 480 media read, 112 sections kept. Measured
  again on the same 15 sentences: the media we read went from 564 to 880, the share of Google's news told by a
  medium we read from 42% to 51%, the share our feeds brought from 12% to 14%.
- The first read of the new feeds brought 21,935 news; grouped in one call they held the ingestion 2 h 10.
- 9.10.2026: the directory brought 106k of the 183k news of a day, the media no briefing used 97k of them.
  Measured without writing: 169 feeds taken out at once (52k news a day), 993 once all are 14 days old (76k a
  day), 580 kept for their share; on "used" alone 1234 media of 1300 would have gone.
- 11%: the share of the news on no interest that reach 0.45 with one anyway (`meaning-judge.js`).

## Diagrams

- [Class diagram](ingestion-directory-class.png) ([source](ingestion-directory-class.puml))
- [Sequence diagram](ingestion-directory-sequence.png) ([source](ingestion-directory-sequence.puml))
- The whole ingestion: [04-ingestion](../04-ingestion.png), [24-ingestion-sequence](../24-ingestion-sequence.png)

## See also

- [Feeds](../feeds/README.md): the runs that read the feeds of the directory.
- [Sources > Discovery](../../sources/discovery/README.md): the sources of one profile, which does not look at `directory_removed`.
- [Sources > Missing sources](../../sources/missing-sources/README.md): the media a search missed, shown to its reader.
