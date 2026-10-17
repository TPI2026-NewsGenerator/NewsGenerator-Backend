# Ingestion > Stories and threads

The news of the last 48 hours are grouped as they come: a **story** is one fact told by several media (the card
of a briefing, the count of its media), a **thread** links the stories of one affair over days (a preview, its
result, the reactions). Both are built in the database, on the bge-m3 vectors, by two PL/pgSQL functions the
background work calls after each batch of news.

## Where

- No page: background work of `IngestService.run` (`services/ingest-service.js`), after the vectors of each
  batch (see [Vectors](../vectors/README.md)).
- `node scripts/assign-threads.js`: once, after `db/add_threads.sql`, a thread for the stories grouped before.
- The readers of the groups: the briefing (the stories), the search (a thread shown as one card).

## How it works

- **One run at a time.** The run holds `pg_try_advisory_lock(hashtext('newsgenerator-ingest'))` on a
  connection of its own, so the server's runs and `pnpm run ingest` never group at the same time.
- **Batches and transactions.** After each batch of 100 news embedded (`INGEST_MAX_EMBEDDED`),
  `StoryModel.assignStories` calls `assign_stories(...)` for 100 news, then `StoryModel.assignThreads` calls
  `assign_threads(...)` for 300 stories (`THREADED_PER_CALL`): each call is one transaction of its own. A
  scheduled run starts no batch after 1 minute (`INGEST_GROUP_MINUTES`), the feeds read included; it groups
  again while the last call took a full 100 and time is left (news embedded by a search, or by a run that
  stopped).
- **A news joins a story** (`assign_stories`, `db/add_briefing.sql`), the newest first, in its language:
  the same link, or the same title of its medium with texts at least 0.6 alike, joins that story whatever it
  scores. Else it is scored on the 100 stories closest by their centroid (plus the stories without one yet):
  the average of dense + sparse of the titles (`STORY_THRESHOLD` 0.70, sparse weight 1) over the members of
  **other media**, only when their texts (title and start of the description) also meet on average above 0.6;
  a story of its own medium alone needs 0.5 more and the same figures in the title (`figures_of`). A story
  loses 0.003 an hour between the news and its newest member, after 6 hours. A title naming a match
  (`matchup_of`: the teams around "vs", "v", "versus") is refused by a story whose members naming a match
  mostly name another one (`different_matches`). Nothing above: a new story. A news without a title is a
  story of its own.
- **A story joins a thread** (`assign_threads`, `db/add_threads.sql`): each story grouped since it was last
  judged gets its centroid again (`l2_normalize(avg(text_dense))`, `halfvec(1024)`) and its media, then joins
  the thread of its language, active in the last 7 days, whose stories it resembles on average above
  **0.75**, judged on the stories of other media (through shared media: 0.10 more), or starts one.
  The threads are first shortlisted, 20 per story, for the whole batch in one query Postgres runs on 3 cores
  (`thread_shortlists`), only the threads at least as close as the 20th of a sample of 1 in 32 sorted.
- **Threads joined.** Two facts of one affair born apart start two threads: the threads touched are then
  joined to the one they resemble most on average above **0.70** (the same 0.10 for shared media).
- **No index on the vectors**, on purpose: the comparisons are exact, on the news of the window, already
  narrowed by the indexes (`i_articles_grouped`, `i_articles_link`, `i_articles_title`).
- **The tagger never waits.** A news the grouping holds in its transaction is skipped by the tagger
  (`FOR UPDATE SKIP LOCKED` in `MentionModel.save`) and tagged later: they had locked each other and Postgres
  cancelled one (13.10.2026).
- **Housekeeping.** Once an hour, after the old news are deleted, `deleteEmptyStories` deletes the stories
  without news, then the threads without story.

## Measured

- Dense + sparse of the titles at 0.70: 96% of the cards gave the right count of media, against 82% for the
  trigrams of the titles (stories judged by hand).
- Other media only: on 5300 news of two days, the stories of one medium went from 284 to 15. The texts must
  meet: 55% of the pairs of two facts cut, 88% of the pairs of one fact kept.
- A quiet story asks more (`bench/story-drift.py`, 40 stories read by hand): 14 of 23 drifted stories cut
  instead of 4, 80 search cards right of 128 instead of 75.
- Matches (`bench/matchup-replay.py`, 36 hours of English news): 19 of 1075 decisions changed, 12 rightly,
  5 a match cut in two by the aliases of a team; the vote cost 13 s a news in the scoring query, about 35 ms now.
- Shortlist of the stories: the same story for all of 450 news, 60 ms a news instead of 145
  (`bench/story-shortlist.mjs`, 5.10.2026). Of the threads: the same thread for all of 800 stories, 50 ms a
  story instead of 250 (`bench/thread-shortlist.mjs`); in one query for the batch, 70 s for 300 stories
  became 4 to 8 s (9.10.2026).
- Threads (`bench/story-threads-online.py`, 316 news of 40 long stories): one fact in one thread 93% (88%
  for the stories alone), one affair in one thread 80% (65%), search cards of one news together 55/74
  (33/74); 23 of 30 threads read were one affair.
- Half precision kept in the row: the score of a news against its window from 1.9 s to 0.23 s, a batch of
  300 from 541 s to 235 s (`bench/halfvec-speed2.mjs`).
- Grouped in one call, the 12,000 news of the first read of the directory held the lock 2 h 10 with no feed
  read meanwhile: hence the batches of one transaction each.

## Diagrams

- [Class diagram](ingestion-stories-and-threads-class.png) ([source](ingestion-stories-and-threads-class.puml))
- [Sequence diagram](ingestion-stories-and-threads-sequence.png) ([source](ingestion-stories-and-threads-sequence.puml))
- The whole ingestion: [04-ingestion](../04-ingestion.png), [24-ingestion-sequence](../24-ingestion-sequence.png)

## See also

- [Vectors](../vectors/README.md): the vectors compared here.
- [Names](../names/README.md): the tagger that skips the news the grouping holds.
- [Briefing](../../briefing/README.md): the stories shown as cards; [Search](../../search/README.md): a thread shown as one card.
