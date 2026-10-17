# Ingestion > Vectors

Each news stored gets the bge-m3 vectors of its title and of its text (the title and the start of its
description): a dense vector for its meaning and a sparse one for its words. The stories, the threads, the
interests of a profile and the search by meaning all compare these vectors, in SQL. They come from a small
Python server, `embedder/server.py`, on this machine or on another one with a graphics card; while it is down
the news are stored anyway and get their vectors at a next run.

## Where

- No page: background work of each run of `IngestService.run` (`services/ingest-service.js`), started by
  `server.js` (see [Feeds](../feeds/README.md)).
- A search that asks Google News a sentence waits for the vectors of what it read: `IngestService.readNow(urls)`
  (`services/news-service.js`), whatever the date of the news.
- `pnpm run embedder` starts the embedder (`127.0.0.1:8020`); `pnpm run ingest:status` gives the news waiting,
  the pace and the time left.

## How it works

- **Which news.** `StoryModel.pendingArticles` (`models/story-model.js`) takes the news without vectors
  (`embedded_at IS NULL`) published in the last 48 h (`WINDOW_HOURS`), the newest first, 100 at a time
  (`INGEST_MAX_EMBEDDED`); the news of the feeds of 500 news a day or more (`isFlood`) after all the others.
- **What is encoded.** Two texts per news, each once per batch: the title, and `richText` = the title and
  400 characters of the description (`DESCRIPTION_CHARS`). The embedder reads 256 tokens a text at most.
- **Several embedders.** `embed` (`services/utils/embedder.js`) asks the health of each address of
  `EMBEDDER_URL` (2 s; one off is asked again every 60 s), then every one that answers takes batches of the
  same call at the same time, one request at a time each: 16 texts on a processor (`CPU_BATCH`),
  `EMBEDDER_BATCH` on a graphics card. One takes the next batch only if it would finish it before the others
  finish all that is left (`worthIt`, on the speed it measured). A connection closed is asked again once; a
  failure hands the batch back to the others and leaves that embedder for the rest of the call. None
  answering: 503, and the news wait for the next run. A token refused (401): `EMBEDDER_TOKEN` differs.
- **The server.** `embedder/server.py`: `BAAI/bge-m3` in fp32, ONNX Runtime on a processor and FlagEmbedding
  (PyTorch) on a graphics card, the same vectors; `GET /health` says `device: cpu | cuda`, `POST /embed`
  answers `{dense, sparse}`, 256 texts a request at most; it refuses to listen on the network without a token
  of 32 characters at least.
- **Saved.** The language is told by the text (`languageOf`), the one of the feed as fallback, else `en`.
  `StoryModel.saveVectors` writes `title_dense`, `text_dense` as `halfvec(1024)` (half precision, kept in the
  row: `STORAGE PLAIN`), `title_sparse`, `text_sparse` as `sparsevec(250002)` (`toVector`, `toSparsevec`),
  `lang` and `embedded_at`, 200 rows a statement (`db/add_briefing.sql`).
- **Overlap.** The embedder works while the database groups: a scheduled run encodes the news already waiting
  while the feeds are read, and each next batch while the one before is grouped. A run out of time (1 minute,
  `INGEST_GROUP_MINUTES`) with more news waiting leaves the next batch encoding (`ahead`): the next run groups
  it first.
- **Older news.** Once the window is done and time is left, `INGEST_OLDER_BATCHES` (1) batch of news of the
  30 days kept gets its vectors, for the search by meaning only: they join no story.
- **Late.** 8000 news or more of the window waiting (`LATE_NEWS`): once an hour the log names the 5 feeds that
  gave the most news in the last 3 hours (`FeedModel.busiestFeeds`).

## Measured

- 512 texts of news: 57 a second on an RTX 4070 Ti, 2.6 on the 6 cores of an i5-12400T, the same vectors
  (cosine 1.000000) (server/README.md).
- ONNX Runtime on the processor: cosine 0.99997 with PyTorch, no likeness moved across a threshold of the
  grouping, 2.9 texts a second instead of 1.75 while the server ingests (`bench/int8`, 3.10.2026). bge-m3 in
  int8 was 3 to 6 times faster but changed 10 to 15% of the closest news of a search or an interest: not used.
- Half precision moves a likeness by 0.0001 at most (`bench/halfvec-precision.mjs`); the table went from
  1.48 GB to 0.99 GB, and a batch of 300 from 541 s to 235 s with the threads (`bench/halfvec-speed2.mjs`).
- Overlapping the embedder with the grouping: it worked 35 s of each run of 95 s before; 200 news a run
  instead of 100 (3.10.2026).
- On a busy processor 64 texts took up to 310 s, past the 300 s `fetch` waits: hence 16 a request there.

## Diagrams

- [Class diagram](ingestion-vectors-class.png) ([source](ingestion-vectors-class.puml))
- [Sequence diagram](ingestion-vectors-sequence.png) ([source](ingestion-vectors-sequence.puml))
- The whole ingestion: [04-ingestion](../04-ingestion.png), [24-ingestion-sequence](../24-ingestion-sequence.png)

## See also

- [Feeds](../feeds/README.md): where the news come from, earlier in the same run.
- [Stories and threads](../stories-and-threads/README.md): what the vectors are compared for, right after.
- [Search > Search by meaning](../../search/search-by-meaning/README.md): the other reader of the vectors.
