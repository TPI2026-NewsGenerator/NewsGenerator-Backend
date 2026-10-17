# Ingestion

The work the server does in background, with no reader waiting: every minute it reads the feeds that are due,
gives the new news their bge-m3 vectors, groups them into stories and the stories into threads; next to it, a
tagger finds the names each news names; every 20 minutes the directory looks at more media, and once a day it
takes out the feeds that serve nobody. The searches and the briefings only read what this work has stored. It
starts from the timer of `server.js` (`IngestService.schedule()`, `TaggingService.schedule()`), unless
`INGEST_IN_SERVER=false`; `pnpm run ingest` makes one run by hand.

## Overview diagrams

- [04-ingestion](04-ingestion.png) ([source](04-ingestion.puml)): the modules of the background work.
- [24-ingestion-sequence](24-ingestion-sequence.png) ([source](24-ingestion-sequence.puml)): one run, and the
  tagging next to it.

## Sub-features

- [Feeds](feeds/README.md): which feeds are read when (2 to 60 minutes by their news, less often when failing),
  the etag, the searches of Google News, the repeats dropped, the 30 days kept, RSS-Bridge.
- [Vectors](vectors/README.md): the dense and sparse vectors of bge-m3, several embedders sharing the batches,
  stored in half precision.
- [Stories and threads](stories-and-threads/README.md): `assign_stories` and `assign_threads` in SQL, their
  thresholds, the matches kept apart, the batches of one transaction and the lock.
- [Names](names/README.md): the GLiNER tagger, `mentions` and `article_mentions`, the names linked to Wikidata.
- [Directory](directory/README.md): the feeds the server adds itself (`directory_feeds`, `directory_tries`) and
  takes out (`directory_removed`).
