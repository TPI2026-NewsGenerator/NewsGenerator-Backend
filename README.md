# NewsGenerator-Backend

## Description

It is a personalizable news generator. <br>
It must be able to read the news, understand it, and show the key passages of the news it has read, taking
into account user parameters such as keywords, desired/undesired topics, language and timeframe of the search.
It also writes a daily briefing for each user, from a profile written in their own words (see **The briefing**
below).

Because it reads hundreds of media at once, it also says how widely a news is carried and how its
article credits its sources. That describes what was measured, never whether the news is true.

## Tech Stack

- [Node.js](https://nodejs.org/) [v22.18.0]
- **Server:** [Express](https://expressjs.com/) [v5.2.1]
- **AI Orchestration:** [Ollama](https://ollama.com/) [v0.6.3], Ollama cloud by default or an Ollama server
  of our own (`OLLAMA_HOST`)
  - model: gemma4:31b (`OLLAMA_MODEL` to change it). Measured against
    gpt-oss:20b, gpt-oss:120b and nemotron-3-nano:30b: the best choice and check of the stories, and 5 to 10
    times fewer tokens, because it does not reason before answering. It can be hosted on one GPU.
- **Vectors of the news:** [bge-m3](https://huggingface.co/BAAI/bge-m3), dense and sparse, computed by a
  Python process of its own with [FlagEmbedding](https://github.com/FlagOpen/FlagEmbedding) and
  [PyTorch](https://pytorch.org/) (`embedder/`, see **Embedder** below). Ollama serves bge-m3 too, but only
  its dense vector.
- **Scraper:** [Crawlee](https://crawlee.dev/js) [v3.16.0]
- **Parsers:**
  - HTML: [LinkeDOM](https://www.npmjs.com/package/linkedom) [v0.18.12] and [Readability](https://github.com/mozilla/readability) [v0.6.0] to extract content
  - XML: [fast-xml-parser](https://www.npmjs.com/package/fast-xml-parser) [v5.3.5]
- **Security**
  - [JsonWebToken](https://www.npmjs.com/package/jsonwebtoken) [v9.0.3] for JWT creation
  - [bcrypt](https://www.npmjs.com/package/bcrypt) [v6.0.0] for password hashing
- **Database**
  - [PostgreSQL](https://www.postgresql.org/) [v18.3-3] (17 at least, see `db/add_google_news.sql`), with:
    - `pg_trgm`, for the keyword search and for grouping the cards of a search list
    - `unaccent`, to compare the titles without their accents
    - [pgvector](https://github.com/pgvector/pgvector), for the bge-m3 vectors: the stories of the briefing,
      the ranking of the interests and the search by meaning are computed in SQL, where the vectors are
  - [Prisma](https://www.prisma.io/) [v7.8.0] as the client
- **Feeds of the sites that publish none:** [RSS-Bridge](https://rss-bridge.org/), self-hosted with
  Docker (optional, see below)

## Getting Started

### Prerequisites

List all dependencies and their version needed by the project as :

[//]: # (* DataBase Engine &#40;MySql, PostgreSQL, MSSQL,...&#41;)
* [Node.js](https://nodejs.org/) [v22.18.0]
* IDE used: [IntelliJ](https://www.jetbrains.com/idea/) [v2025.3.3]
* Package manager: [pnpm](https://pnpm.io/fr/) [v10.28.2]
* [Python](https://www.python.org/) with pip, for the embedder (`embedder/requirements.txt`)
* [PostgreSQL](https://www.postgresql.org/download/) 17 or later, with [pgvector](https://github.com/pgvector/pgvector)
  installed on the database server
* OS supported: All (web based)

[//]: # (* Virtualization &#40;Docker, .Net, .JDK, .JRE&#41;)

### Configuration
#### Ollama

1. Visit Ollama [website](https://ollama.com/), create an account and create an API Key
under `Settings -> Keys -> Add API Key`

2. Rename `.env.example` to `.env` and insert you api key file:
```
OLLAMA_API_KEY=your_api_key
```

3. Optional: `OLLAMA_MODEL` changes the model (gemma4:31b by default), `OLLAMA_HOST` names an Ollama server
of our own instead of Ollama cloud (`http://127.0.0.1:11434`), which needs no key.

#### Embedder

The bge-m3 vectors of the news, of the interests and of a search written as a sentence come from
`embedder/server.py`, a small HTTP server in Python. Without it the news are still stored, and get their
vectors once it answers; the profiles, the briefing and the search by meaning need it.

```bash
pip install -r embedder/requirements.txt
pnpm run embedder        # listens on 127.0.0.1:8020, loads BAAI/bge-m3 first
```

A graphics card encodes the news of 48 hours in a minute or two, the processor of the server in hours.
So the embedder can run on another machine. There, `embedder/.env` (or the environment) gives:

| Variable | Description |
|---|---|
| `EMBEDDER_HOST` | the address it listens on, `127.0.0.1` when not given. `0.0.0.0` to open it to the network |
| `EMBEDDER_PORT` | `8020` when not given |
| `EMBEDDER_TOKEN` | the secret the server must send, at least 32 characters. Required as soon as the address is not this machine only: the embedder refuses to start without it |

and the `.env` of the server gives its address and the same secret:

| Variable | Default | Description |
|---|---|---|
| `EMBEDDER_URL` | `http://127.0.0.1:8020` | where the embedder answers. Several, separated by commas: the first that answers is used, the ones before it are asked again every minute (see below) |
| `EMBEDDER_TOKEN` | _(none)_ | the same secret as the embedder |
| `EMBEDDER_BATCH` | 16 | texts per request. On a busy processor 64 texts took up to 310 s, and `fetch` gives up at 300 s. A graphics card answers 16 texts in a fraction of a second: 128 saves the round trips. An embedder saying it runs on a processor always gets 16 |

The firewall of that machine should also let only the server reach the port. The vectors are computed in
fp32 on the card too, so they stay the ones of the processor, already stored and measured on the benches.

#### Database

1. Download [PostgreSQL](https://www.postgresql.org/download/)
2. Open "pgAdmin 4.exe" application
3. Create new Database (*Right-click* **Databases** -> Create -> Database...)
4. Open Query Tool on the database (*Right-click* **New_Database** -> Query Tool) **[Alt + Shift + Q]**
5. Open File **[Ctrl + O]** -> open "create_insert_NewsGenerator.sql" from `server/db`
6. Execute script **[F5]**
7. Do the same with "create_feeds_cache.sql" (RSS cache tables `feeds` and `articles`)
8. Do the same with "add_articles_search.sql" (text searched by the keywords filter, with a `pg_trgm` index)
9. Do the same with "add_user_feeds.sql" (sources added by the users)
10. Do the same with "add_articles_sourcing.sql" (who an article credits, answered by the AI)
11. Do the same with "add_unaccent.sql" (compare the titles without their accents when grouping)
12. Do the same with "add_briefing.sql" (the stories, the vectors of the news, the profiles and their
    interests, the briefings, and the SQL functions `assign_stories` and `rank_stories`). It creates the
    `vector` extension: pgvector must be installed on the server, and the first run needs a superuser
13. Do the same with "add_trusted_sources.sql" (the sources a reader trusts, the ones they keep)
14. Do the same with "add_source_growth.sql" (the sources a reader shares with the others)
15. Do the same with "add_google_news.sql" (the real publisher and address of the news read through
    Google News). Needs PostgreSQL 17 or later
16. Do the same with "add_feed_failures.sql" (how many refreshes of a feed failed in a row)
17. Do the same with "add_extracts.sql" (the key passages of an article and their translation)
18. Do the same with "add_signup.sql" (one account per name and per email, whatever their case)
19. Do the same with "add_threads.sql" (the threads linking the stories of one affair, and the SQL
    function `assign_threads`), then run `node scripts/assign-threads.js` once for the stories already grouped
20. Do the same with "add_directory.sql" (the feeds the server finds itself, see **The directory** below),
    then run `node scripts/grow-directory.js` once to fill it

The scripts are in this order on purpose: each one only adds what the one before did not create, so a
database already in service is brought up to date by running the missing ones, without losing its cache.
`add_summary_language.sql` is not in the list: `add_extracts.sql` replaces it and drops its column, so
a database that ran it is cleaned by the next one.

To generate **prisma schema**:
```bash
npx prisma db pull
```

To generate **prisma client**:
```bash
npx prisma generate
```

#### Environment
To install dependencies:
```bash
pnpm install
```

To start a development server:
```bash
pnpm run server
```

### Background work: feeds, vectors, stories and threads

The server reads every feed every `INGEST_INTERVAL_MINUTES` (20 by default), gives the new news their
bge-m3 vectors, groups them into stories and links the stories of one affair into threads
(`services/ingest-service.js`). Nobody waits for it: the
searches and the briefing read what it has already stored. The vectors come from the embedder, a
Python process (`embedder/server.py`, on this machine or another one with a graphics card, see
`EMBEDDER_URL` in `.env.example`); while it is down the news are stored anyway and get their vectors
at the next run.

Two embedders can share the work: a graphics card that is not always on, then a machine that is.
Measured on 512 texts of news: 57 a second on an RTX 4070 Ti, 2.6 on the 6 cores of an i5-12400T
(12 threads gave no more), the same vectors (cosine 1.000000). The processor keeps up with the feeds
(about 1600 news an hour, a third of what it can do), but a search Google News completes waits about
a minute for its 70 news instead of 3 seconds: the graphics card goes first, the processor takes over
while it is off, and gives the work back a minute after it answers again. On a machine without
Python packages, the embedder runs in Docker (`embedder/Dockerfile`, PyTorch for the processor only):

```bash
docker build -t newsgenerator-embedder:cpu embedder
docker run -d --name newsgenerator-embedder --restart unless-stopped --cpus 6 --memory 6g -p <its address>:8020:8020 --env-file token.env -v ./cache:/cache newsgenerator-embedder:cpu
```

`token.env` holds `EMBEDDER_TOKEN=` and the same secret as the server, readable by its owner only.

```bash
pnpm run ingest:status   # where it stands: news of the window with their vectors, waiting ones, pace, time left
node scripts/assign-threads.js   # once, after db/add_threads.sql: a thread for the stories grouped before
pnpm run ingest          # one run now, by hand (a run of the server at the same time is skipped, a lock keeps them apart)
pnpm run embedder        # starts the embedder on this machine
```

The news of the last 48 h are embedded and grouped first, the newest first, by batches of
`INGEST_MAX_EMBEDDED`, each grouped in a transaction of its own. A run starts no batch once it has
worked `INGEST_GROUP_MINUTES`, the feeds read included: a big backlog (the first read of many new feeds) waits for the next runs, which
read the feeds before. A time rather than a number of batches: a batch of 300 took 4 minutes, then 9
with 31 000 news in the window, 4 since the vectors are in half precision (see **The stories of the
briefing**). Grouped in one call,
the 12 000 news of the first read of the directory held the ingestion 2 h 10 with no feed read meanwhile,
and nothing saved before the end. The older news kept (`FEED_RETENTION_DAYS`)
that have no vectors yet, because the embedder was down longer than the window or a feed came with
old news, are embedded for the search by meaning once those of the window all have their vectors and
stories and while the run has time, `INGEST_OLDER_BATCHES` batches of `INGEST_MAX_EMBEDDED` per run,
and join no story (on the processor alone a batch of them took the place of one of the window). To catch up a long backlog at once:

```bash
INGEST_GROUP_MINUTES=600 INGEST_OLDER_BATCHES=200 pnpm run ingest
```

The searches of Google News of the interests are read by the same runs, less often (see **Google News**
below).

Optional variables in `.env`:

| Variable | Default | Description |
|---|---|---|
| `INGEST_IN_SERVER` | on | `false` leaves the background work to `pnpm run ingest`, run by a scheduler of the system |
| `INGEST_INTERVAL_MINUTES` | 20 | the time between two runs |
| `INGEST_MAX_EMBEDDED` | 300 | news embedded, saved and grouped at a time. On a busy processor 1500 news at once took over an hour, all lost if the process stopped before saving them |
| `INGEST_GROUP_MINUTES` | 10 | a run starts no batch of the window after these minutes, the feeds read included (a batch of 300 takes about 4): the rest waits for the next run |
| `INGEST_OLDER_BATCHES` | 1 | batches of older news without vectors embedded per run, for the search by meaning |
| `FEED_RETENTION_DAYS` | 30 | Articles older than this are deleted |
| `RSS_BRIDGE_URL` | _(none)_ | Address of the RSS-Bridge, step 4 of the sources of a user below. Empty: the sites without a feed are simply out of reach |
| `GOOGLE_NEWS` | on | `off` stops every request to Google News: the searches of the interests, and the sentence a search asks when our sources answer little |
| `SEARCH_GOOGLE_NEWS` | on | `off`: the sentences searched are not asked to Google News (the searches of the interests go on) |
| `GOOGLE_NEWS_EVERY_MINUTES` | 60 | each search of Google News is read again after this |
| `GOOGLE_NEWS_INTERVAL_MS` | 1000 | two requests to Google never closer than this |
| `DIRECTORY` | on | `off` stops the directory from looking at more media after each run (the feeds it has are still read) |
| `DIRECTORY_PER_RUN` | 10 | media the directory looks at after each run, of each kind (named by Google News, already read) |
| `MEDIACLOUD_API_TOKEN` | _(none)_ | key of [Media Cloud](https://search.mediacloud.org) (free account, 8000 requests a week), the second directory of media of the discovery (see **Media Cloud** below). Empty: the discovery asks Google News only |

### Documentation

| Where | What |
|---|---|
| `http://localhost:3001/docs` | every route, with its body and its answers (Swagger UI). It is written in `config/swagger.js`, which is the only source: there is no `.yaml` to keep in step with it |
| `docs/MLD_sprint4.md` | the fifteen tables, their columns and their keys, to redraw the MLD |
| `docs/UML/sprint4/` | the class diagrams, one per feature (accounts, saved searches, search, ingestion, sources, profile, discovery, briefing) and an overview of what links them (`0*`), and the sequence diagrams of the signup, the search, the briefing, the discovery and the ingestion (`1*`), as source and as PNG. Render them again with `java -jar plantuml.jar -charset UTF-8 docs/UML/sprint4/*.puml` |
| `docs/UML/*-diagram.puml` | the sequence diagrams of the login and of the saved searches, from sprint 1, brought up to date |
| `docs/*.png` | the MCD, MLD and class diagrams of sprints 1 to 3, kept as they were |

### How a search works

1. The feeds of `db/rss-links.js` are grouped by language, then by category (world, press, sport,
   politics, economy, technology, science). The user chooses the language and the categories, that
   is the first filter. There are 415 feeds: 335 in English, 25 in French, 20 in Spanish, 20 in
   German, 15 in Italian. A search never mixes two languages, and one in French has no reason to
   read the English sources.
2. A search fetches no feed: it only reads the `articles` table, filled in background (see
   **Background work** above), so nobody waits for a feed. Besides the shared feeds of the language
   and categories chosen, a search reads the sources of the readers that are not private, of that
   language and those categories (`FeedModel.publicFeedUrls`, `searchesOfCategories`):
   - the sources of the user searching, those they added by hand included;
   - the feeds found for the profile of any reader, and the ones a reader chose to share;
   - the searches of Google News of the interests of every profile. They say which subjects are
     followed, never by whom;
   - the feeds of the directory of the project, found by the server itself, of that language and of
     those categories or of none (see **The directory** below).

   A source added by hand and not shared stays its reader's: nobody else searches it. Measured for
   one reader (`bench/pool-sources.mjs`, French, 30 days): "cartes Pokémon" found 1 news in the shared
   feeds and their own, 2 with the feeds found for the other profiles, 10 with their searches of
   Google News. The briefing still reads only the sources of its reader.

   A news read through Google News is shown under the medium Google names. Its real address is only
   asked to Google when its key passages are asked for and the card has no other article to read
   (2 per card, 10 at most), since Google soon answers 429 on the pages of its articles, and then no
   real address is asked for an hour (the searches of Google go on).
3. What was typed decides how it is searched (`Filter.hasOperators`):
   - **A sentence**, without any operator, is searched by its meaning (`NewsService.searchByMeaning`).
     The embedder gives the vector of the sentence, and `FeedModel.closestArticles` takes, among the
     news of the chosen feeds and timeframe that have their vectors, the **80 closest** (dense + 0.5 ×
     sparse, as the briefing ranks the news of an interest) and the **30 with the most of its words**
     (the sparse vector alone), which keeps the news naming what the sentence names when their meaning
     is further. The AI then reads their titles and the start of their descriptions, each title once,
     and sorts them into two lists (`services/utils/search-ai.js`): the **answers** to the sentence, and
     the news that are only **related** to it (another place, another aspect). The cards come in its
     order, the answers first, and the news in no list are left out.

     Measured on 13 sentences in French and English (`bench/meaning.mjs`, `meaning-ai.mjs`): the vectors
     alone rank a broad subject well, but not a sentence that names someone, a place or an aspect ("AI
     at the hospital" gave AI in general), nor one that excludes something, and their scores do not say
     where the answers stop. So they only bring the candidates, the AI judges them. Asked for one list,
     it left out news a reader would want (fuel prices for "the rise of energy prices"), hence the
     second one. 80 + 30 news are 4000 to 7000 tokens, answered in 1 to 3 seconds.

     Without the AI, the 30 closest are given, marked as not checked. Without the embedder, the
     sentence cannot be searched: the reader is told to put their words between quotes.

     Google News is asked every sentence too, over the days searched (30 at most), while our sources
     are searched; its news are read and embedded at once (`IngestService.readNow`). Google learns the
     sentence, never who searched it. It is not asked while it is turned off or paused after a block,
     and a search it does not answer keeps the answer of our sources.
     - When fewer than 5 news answer, the subject is one our sources do not follow: the search waits
       for Google and searches again with its news; the reader is told. The 40 closest news of that
       Google feed are read by the AI whatever the others: among every feed, the vectors ranked
       "Claude Sonnet 5.5" 151st for "new AI models for programming" and the AI, reading the first 110,
       never saw it (4 cards, 12 with them). Measured on the 15 sentences of `bench/vs-google.mjs`
       (30.09.2026): "measles outbreaks" went from 1 answer to 10, with 32 close ones all on measles;
       "the Swiss chocolate industry" from 0 to 11. A subject Google has nothing on either stays with
       little ("les vendanges en Valais"). Such a search takes 5 to 11 seconds instead of 2 to 5.
     - Otherwise the search answers at once, and Google's news join the database for the searches after
       it: every search reads the feeds of Google News of the sentences searched in its language during
       the retention, as it reads the searches of the profiles. Asked only for the searches answering
       little, 40% of Google's first 30 news were in none of our feeds (01.10.2026), all of them from
       the 8 searches it was not asked.

     `SEARCH_GOOGLE_NEWS=off` turns both off.
   - **Keywords with an operator** (a quote, a comma or a `-word`) are searched as written, in SQL, with
     the excluded keywords and the timeframe. They work like on Google: commas separate alternatives
     (OR), the words of an alternative must all be found (AND), `"quoted text"` is an exact word or
     phrase and `-word` excludes.

   In the keyword search, asking for every word at once is strict: `"referee" football soccer` wants
   the three of them in the same news, and almost none has all three. So when a search finds fewer
   than five news, the wider search asking for *any* of the words is counted and **offered**, not
   done — widening `"red card"` on its own would answer everything about red or about card. See
   `canWiden` and `widen` in `services/utils/filter.js`.
4. News telling the same story are grouped: one card, with the other sources listed under it. The
   list of a search is grouped here, with the trigrams of the titles; the briefing reads the stories
   built in background with the vectors instead (see **How the groups are built** below). An
   article joins the group it resembles **on average** above **0.25** of trigram similarity — under
   40 characters the stricter **0.45** is kept, because a short title is mostly the template its
   paper puts around it and trigrams cannot tell "Health Care Roundup: Market Talk" from "Auto &
   Transport Roundup: Market Talk". Both constants are at the top of `services/news-service.js`, and
   **How the groups are built** below says why the average and not a single link.

   The accents are removed before comparing. Two papers do not spell a name the same way: the
   Guardian writes "Higuaín" where the Independent writes "Higuain", and that one accent moves the
   pair from 0.325 to 0.294, which is the difference between grouped and not grouped. Measured on a
   day of articles it adds 0.75% of pairs, almost all of them French, Spanish or Italian, where
   accents are common. It needs `db/add_unaccent.sql`.
   The cards of one affair are then one card (see **The threads** below): the preview of a match, its
   result and the reactions are three facts, shown under the card in their order, with the facts of
   the affair the search did not find, read from the feeds of this user only. Each fact can be chosen
   for its key passages.
5. Each card says what the grouping measured, and nothing more (see **Corroboration** below).
6. A user can add their own sources (`POST /api/feeds` with a site address): the server finds the
   RSS feed of the site and checks it answers. These sources are **private**, they are only used in
   the searches of this user, unless they share them. Addresses of private networks are refused, see `services/utils/public-url.js`.
   The feed of a site is looked for in four steps, each one tried only when the one before found
   nothing (`services/utils/feed-finder.js`):
   1. the feed the page declares, `<link rel="alternate" type="application/rss+xml">`, except the
      feed of the comments a WordPress site declares next to its news (`/comments/feed`);
   2. the usual paths, `/rss`, `/feed`, `/rss/news`...;
   3. a directory of feeds, which knows the ones a site declares nowhere and that are on no usual
      path (`feed-directory.js`): this is what finds football.london and uefa.com;
   4. the site read as a page and turned into a feed by RSS-Bridge (`feed-bridge.js`), for the news
      sites that publish none at all: goal.com, onefootball.com, realmadrid.com.

   On 30 media that searches were missing, 17 publish a feed, 6 more are reached by step 4, and 7
   answer 401 or 403 to any server and stay out of reach (Reuters, AP, Man City).
7. The media the search missed are named to the user, so the list of sources grows from what the
   searches actually lacked (see **Missing sources** below).
8. The pages are read and the AI is called **only** on the cards selected by the user
   (`NewsService.summarizeStories`, at most 10 cards). Up to 5 articles of each card are read, one per
   medium and a source the reader trusts first: their texts say how many were written apart from the
   others (no AI, see **Corroboration** below). The first one that can be read in full gives the
   **key passages** of the card (see **Key passages** below). They are saved with the article, so the
   same news asked twice costs nothing, and its translation is kept for the last language asked.

#### Key passages

The AI never writes a summary. Summaries written by the AI changed what the article says in 4 of 30
articles, 3 of them again in a second run: a cause the article never gives, a certainty turned
around, the words of one person given to others. Told four rules against it, it made none of those in
the same 30, but still minor slips, and a news service cannot show that.

So the AI only picks sentences (`services/utils/extract.js`). The article is cut into numbered
sentences (headings and captions left out, quotes marked), and the AI answers, in one call, the
numbers of the 2 to 5 sentences that tell the news best, its topic and its sourcing. The code shows
those sentences **word for word, as the article published them**, back in the order of the article,
about 170 words at most; sentences that follow each other make one passage, and a gap between two
passages is shown. A page with fewer than 60 words (a teaser, a paywall) is not used.

When the article is not in the language of the reader, a machine translation is added, marked as such,
next to the original sentences. It is asked sentence by sentence and checked rather than trusted: a
translation that loses a figure of its sentence, or does not give one sentence per sentence, is asked
once more, then left out, and the reader gets the original only. A figure written the way of the other
language is the same figure: "1,000" and "1 000", or "7 p.m." and "19h00".

#### Corroboration

The project scrapes many media at once, so it can say how widely a news is carried. It says that,
and refuses to say anything else: **a rumour repeated by twenty sites is still a rumour**, and no
number here means a news is true.

These things are shown next to a news, each one measured, none of them a verdict:

| Shown | Where it comes from |
|---|---|
| `N media` | how many different media the group holds, counted per medium and not per feed (`mediumOf`). In the briefing, a news read through Google News counts for the medium Google names as its publisher, not for google.com |
| `M wordings` | in the list of a search: the same titles grouped a second time at 0.85, which is the threshold of the same text: a wire of Reuters republished by twenty sites gives twenty media but one wording, and that is one report seen twenty times, not twenty confirmations. Never more than `N`. |
| written apart, agencies | once the articles are read (a card selected in a search, a story of the briefing): up to 5 texts per card, compared on their sequences of eight words. Two texts are the same copy when half of the sequences of the shorter one are found in the other, because a paper rewrites the title of a wire and keeps its text. It also names the agencies the texts credit ("avec AFP", "(Reuters)"). No AI, see `services/utils/corroboration.js`. |
| `says "reportedly"` | the words the article itself used to say it has no confirmation (`services/utils/hedging.js`). It reports how the article presents itself, and the article's own words are shown rather than a label. Conditionals are left out: French and Italian use them for ordinary reported speech. |
| `named` / `unnamed` / `no source given` | who the article credits, answered by the AI in the call that picks the key passages, so it costs no extra call. It describes the article, never the truth of the news: an official statement can be a lie and an unnamed source can be right. |

A group of one medium says `this source only`, which is the honest answer and not a warning.

**Above ten articles, the card stops claiming to be one news** and says `N media on this story`.
It is a safety net that nothing reaches today: the largest true group measured holds eight
articles, and nothing between nine and eleven exists at all. It used to be five, when the grouping
chained (see below) and a card could hold thirty-one articles from a court filing to the late-night
jokes about it.

#### How the groups are built

The news are grouped in two places, in two ways:

| | where | with what | on which news |
|---|---|---|---|
| the stories | the background work, `assign_stories` in `db/add_briefing.sql` | the bge-m3 vectors, dense + sparse, in SQL | the news of the last 48 hours, as they come |
| the list of a search | `NewsService` (`groupDuplicates`), at each search | the stories above; the trigrams of the titles, in SQL (`FeedModel.similarArticlePairs`), for the news in no story | the results of the search, from the 30 days kept |
| the threads | the background work, `assign_threads` in `db/add_threads.sql` | the mean of the vectors of each story, in SQL | the stories of the last 7 days |

The briefing shows the stories. A search groups its results by their story too, so a news gets the
same card and the same count of media in both. The stories only exist for the news embedded within
48 hours of their publication: the older ones (caught up later, see `INGEST_OLDER_BATCHES`) get their
vectors for the search by meaning but join no story, and those are grouped among themselves by the
trigrams of their titles.

Measured on eleven searches of a week (`bench/story-cards.mjs`), every card where the stories and the
trigrams disagree read by hand: the stories were right 74 times, the trigrams 31. The trigrams join
different news whose titles share words ("Premier League", "Russia", "Ukraine"), and cut one news told
in other words. The stories make fewer mistakes, but some: a story may keep growing from day to day
(an invitation to the G-20 on Monday, a call to settle with Putin on Friday), and one news may land in
two stories. Grouping the results again with the rules of the stories, without their order, did no
better than the stories and made big cards of a whole subject.

The search by meaning also sends one line per story to the AI, not one per article.

##### The news in no story: trigrams

An article joins the group it resembles **on average**, not the one where it found a single link
(`services/utils/grouping.js`). Grouping on single links chains: A and B tell the same news, B and C
too, so A and C end up together whatever they have to do with each other.

Measured on 500 articles in each of four languages, scored against forty groups read and judged by
hand:

| | recovered whole | largest group (en/fr/es/it) |
|---|---|---|
| single link, 0.30 | 34/40 | 8 / 27 / 10 / 15 |
| single link, 0.25 | 40/40 | 8 / **45** / 11 / 21 |
| **average, 0.25** | **39/40** | **8 / 8 / 8 / 7** |

None of them ever puts two media on a news they do not share. The threshold drops from 0.30 to 0.25
because resembling a whole group is a harder question than resembling one of its members, so it is
asked with a lower bar: at 0.30 the average only recovers 16 of the 40.

The pairs the database leaves under the threshold count as no resemblance at all rather than being
fetched. Measured both ways, that changes nothing, so the query stays as it is.

Two other answers were measured and rejected. Weighing the words by how rare they are (TF-IDF) does
worse, because a template is rare too: "Prediction and Betting Tips" is written by one site alone,
so rarity hands it a high weight and joins eight unrelated matches. Dense embeddings alone, run by
Ollama, judge **pairs** better than anything else here — they alone bring "Columbus Crew sack coach
Higuaín" near "MLS coach sacked after sexist remark" — but they build worse **groups**, 32/40 against
39/40, and cost ten seconds on a large search when computed at the search. A better judge of pairs
does not make a better grouper.

`scripts/compare-grouping.js` is the bench that says all this: it scores every measure and every way
of building the groups against the pairs judged by hand, and it can be run again.

##### The stories of the briefing: bge-m3 dense + sparse

The dense vector alone joins two templates that share a meaning but no name ("Egypt vs Angola -
Betting Tips" and "Togo vs Burundi - Betting Tips"). The sparse vector of bge-m3, the weight it gives
to each word, keeps them apart, and only FlagEmbedding gives it (`scripts/bge-hybrid.py` is the bench
of the pairs judged by hand with it). Computed once per news in background, the vectors cost nothing
at the search or the briefing.

A news joins the story of the last 48 hours, in its language, that it resembles **on average**, as in
the search, or starts a new one. The newest first, one at a time, so a news can join a story started
by another of the same run. The resemblance is dense + sparse of the titles, above **0.70**. Measured on
the stories judged by hand: 96% of the cards gave the right count of media, against 82% for the
trigrams of the titles, and it barely depends on the order.

Four rules were added, each one measured:

- **A story is judged on the other media.** A medium repeats its own templates ("Is Portugal v Wales
  on TV?", "Is Netherlands v Germany on TV?"), so two of its titles look alike without telling the
  same fact. A news is compared with the members of other media only; a story of its own medium alone
  takes it only with almost the same title (0.5 more) and the same figures ("Sept. 23" and "Sept. 22"
  are two broadcasts). On 5300 news of two days, the stories of one medium went from 284 to 15, all of
  them the same fact.
- **The texts must meet too.** Two media can write on one subject without telling the same fact
  (fuel prices in Europe and in Japan, a product launch and a bug found in it): their titles meet, the
  start of their texts much less. So a news joins a story of other media only when its text (the
  title and the start of the description) is also close to theirs on average, above 0.6. On the 640
  stories of several media of the same 5300 news, 55% of the pairs of two different facts are cut and
  88% of the pairs of one fact kept, and the big stories stay whole.
- **The same news met again joins its story** whatever it scores: the same link, or the same title in
  its medium.
- **A quiet story asks more.** Over days a story drifts: the preview of a match takes its result, the
  first day of a tournament the next ones, since they share every name. So the score of a story loses
  0.003 per hour between the news and its newest member, after 6 hours: a news almost the same still
  joins days later (a verdict reported again), a preview and its result no more. On a replay of the
  grouping over five days (`bench/story-drift.py`), 40 stories over a day long read by hand: 14 of 23
  drifted stories cut instead of 4, 2 of 12 stories of one fact instead of 1, and 80 search cards right
  of 128 instead of 75. Hard limits (a story at most 24 hours old) cut the stories of one fact as much
  as the drifted ones.

No HNSW index on the vectors, on purpose: the comparisons are always made on the news of the last 48
hours (a few thousand rows, already narrowed by the indexes), and exactly. An approximate "nearest k"
does not answer an average over the members of a story, and an exact scan takes milliseconds.

The dense vectors of the news are stored in half precision (`halfvec`, 2 KB) kept in the row. As
`vector(1024)`, 4 KB each, Postgres stored them apart (TOAST, 1.15 GB of the 1.48 GB of the table) and
read them back each time a likeness used them, several times per news: a batch of 300 news took 9
minutes to group, less than the news coming in. Half precision moves a likeness by at most 0.0001
(`bench/halfvec-precision.mjs`, on the real news): the same story for 120 news of 120, no threshold
crossed over 740 000 stories compared, the same 80 news given to the AI for 15 sentences of 17 (the
80th swapped for the 2 others), the same 50 news for each of the 15 interests of the profiles. With
each likeness computed once (`OFFSET 0`) and an index for the same news met again, the score of a
news against its window went from 1.9 s to 0.23 s on a copy of three days (`bench/halfvec-speed2.mjs`),
and a batch of 300 from 541 s to 235 s with the threads, the rest read again from outside the memory of
Postgres (128 MB of `shared_buffers`). The table went from 1.48 GB to 0.99 GB.

No threshold of the vectors separates every pair of facts, so the few stories of a briefing are read
once more by the AI before they are shown (see **The briefing** below).

##### The threads: the facts of one affair

A story tells one fact, and a quiet story asks more of a news (see above): the preview of a match and
its result are two stories. The vectors measure what a news is about (names, subject) far better than
what happened in it, so no rule on the stories alone keeps both the facts apart and the affair
together: the stricter they are, the more a fact reported again two days later is cut from itself.
So there are two levels. The stories stay strict, and the stories of one affair are linked in a
**thread** (`assign_threads` in `db/add_threads.sql`, after each grouping):

- each story that got news is judged again on the mean of its news (`stories.centroid`, the text
  vectors of its news), and joins the thread of its language, active in the last 7 days, whose
  stories it resembles on average above **0.75**, or starts one. As for the stories, it is judged on
  the stories of **other media**: a medium repeats its own series ("Moon phase today", ETF dividends,
  "Match ce soir") that look alike without being an affair, so through stories of its own media it
  needs **0.10** more;
- two facts of one affair born apart start two threads that nothing would join afterwards (the Man
  City verdict and the reactions to it), so the threads touched are joined to the thread they
  resemble most on average above **0.70**, with the same 0.10 for shared media.

Measured on a replay run by run of five days of news (`bench/story-threads-online.py`), against 316
news of 40 long stories labelled by hand with their affair and their fact
(`bench/data/story-drift/facts.json`):

| | one fact in one thread | one affair in one thread | search cards of one news together | 30 threads read: one affair |
|---|---|---|---|---|
| the stories alone | 88% | 65% | 33/74 | |
| threads, without joining threads | 91% | 72% | 53/74 | 24/30 |
| **threads, joined at 0.70 + 0.10** | **93%** | **80%** | **55/74** | **23/30** |
| threads joined without the 0.10 | 92% | 77% | 60/74 | 18/30 |

The threads read that were not one affair were three series of one medium and four too broad (the
qualifiers of a whole competition, the transfer rumours of a club). The briefing keeps showing the
facts; the search shows a thread as one card.

The centroids are stored in half precision (`halfvec`, 2 KB) kept in the row: a story is compared
with every story of its language of the week at each run, and read that way they are read about
three times faster than a `vector(1024)` of 4 KB that Postgres stores apart. A run judges a hundred
stories or so in a few seconds; a week of stories judged at once (`scripts/assign-threads.js`) takes
about ten minutes.

#### Missing sources

A search only finds what the sources publish, so the sources are grown from what the searches
actually missed, not from a list decided in advance. After a search, the same keywords are asked to
two public directories, and the media they name that are not in the cache are shown to the user:

- **Google News**, whose RSS gives the publisher of each result in clear (`services/utils/google-news.js`);
- **GDELT**, the DOC 2.0 API, as a second opinion (`services/utils/gdelt.js`).

Their news are shown **read-only** — the pages are not scraped and the AI never sees them, they are
only there to show what the search did not have. Next to them, the media whose feed was found can be
added in one click, and they become private sources of that user.

The feed offered for a medium is its section on the search, not its main feed, and a medium with no
feed on the search is not offered (`SourceService.suggest`). Which news of a feed are on the search is
judged by meaning, as the discovery judges the feeds of a profile: the bge-m3 vector of the search
against each title, at 0.45 (`services/utils/meaning-judge.js`), and a feed needs 2 news on it. Measured
on 9 searches in French and English (`bench/web-quality.mjs`): judged by the words and offered even off
the search, 45 feeds were offered and about 7 were on it (the main feed of midilibre.fr for the video
refereeing of Ligue 1, its sample the weather); judged by meaning, 21 and about 16 (the Ligue 1 feeds of
midilibre.fr and ladepeche.fr). Without the embedder the feeds are judged by the words.

Having the AI sort the news of Google first, and trying only the media of its answers, was measured and
left out: 10 feeds instead of 21, with the same share on the search. A sentence gets few answers (1 of
17 for the Ligue 1 one), so good media were never tried (dsih.fr for "l'intelligence artificielle à
l'hôpital", the Top 14 feed of sudouest.fr), and the rugby news stayed as close to the Ligue 1 all
the same. The news shown read-only are Google's, newest first, unsorted.

The judge makes the search wait on the embedder: about 20 seconds, but 13 minutes measured while the
GPU of the embedder was busy with something else.

Which media are already searched is decided on the links of the articles, not on the addresses of
the feeds: a feed is often served from another domain than the site it publishes
(`feeds.bbci.co.uk` for bbc.com, feedburner for anybody), so comparing feed addresses would suggest
media that are in fact already read.

GDELT answers slowly and rate-limits: `fetch()` gives up at 10 seconds whatever timeout is asked, so
these calls use `node:https`, where the timeout is really honoured. A search waits 6 seconds at
most, and gets no suggestion from GDELT rather than a slow answer; the offline script below waits
30 seconds and retries.

Four scripts do the same work without anybody waiting:

```bash
node scripts/check-coverage.js "referee" sport      # what the cache finds vs what Google News finds
node scripts/find-feeds.js https://www.skysports.com # the feed of one site, to fill db/rss-links.js
node scripts/find-missing-sources.js --days 3       # sweeps the accumulated missing media, by batches
node --env-file=.env scripts/import-awesome-feeds.js # the new feeds of awesome-rss-feeds worth adding
```

`import-awesome-feeds.js` reads the lists of [awesome-rss-feeds](https://github.com/plenaryapp/awesome-rss-feeds)
(CC0) by country and by subject, reads each feed once and prints the ones alive (a news of less than
30 days, 5 news at least), written in one of our languages, that are no podcast, no video channel, no
social network and no medium already read in that language and category. Nothing is added by itself:
the ones chosen are pasted into `db/rss-links.js`; the ones not wanted are set aside in the script, so
a new run only proposes what is new in their lists. 34 were added this way on 30.09.2026.

`find-missing-sources.js` separates what it finds: the media that publish a real feed are printed
ready to paste into `db/rss-links.js`, and the ones that only work through RSS-Bridge are printed
apart. The second group is deliberately **not** put in the shared catalogue, which would make it
depend on Docker being up; they are meant to be added as user sources.

#### The directory

A search only finds what some feed brings, and most of what Google News finds no feed of ours brings.
Measured against it (`bench/vs-google.mjs`, 15 sentences in French and English over 7 days, its first
30 news judged by hand): 76% of its news were in no feed of ours. A third of those came from media we
read, through a section their feeds miss (the health of nbcnews.com, the missions of nasa.gov), two
thirds from media we did not read at all. Google publishes no list of its sources, and the paid lists
(Feeder, NewsAPI...) are only readers of feeds, or send the searches of our readers to someone else.
So the server grows a directory of its own (`services/directory-service.js`, `db/add_directory.sql`),
read by every search of its language, from two things it already has:

- **the media Google News names** at least 3 times in 30 days in the searches the server reads: those of
  the profiles (see **Google News** below), and the sentences a search asked it (medicaldaily.com came
  from "measles outbreaks"), when no feed every reader can search reads them. A medium says nothing of
  who searched it. Their main feed is looked for (`findFeeds`, without the bridge: it would load
  hundreds of pages every 20 minutes) and kept when it
  has news of the last 7 days, is written in one of our languages (told by its own news: ua.news,
  named by an English search, is in Ukrainian), is no podcast and holds no key in its address. It goes
  in no category: a newspaper named by a search on sport writes on everything;
- **the sections of the media already read**: every feed a site declares, lists on its page of feeds
  ("/rss/") or the directory of Feedly knows, is read once, and kept when most of its news of the last
  7 days are news our feeds of that medium miss (3 at least): a feed "all the news" of a medium read
  through its main feed brings the same news twice, and nothing else. 2 per medium at most, the one
  bringing the most first, the news of the first counting as read for the second. Its category is
  read in its address ("/health/" is science), else it is the one of the medium.

A medium looked at is not looked at again before 30 days, found or not. The first time, every medium is
looked at by `node scripts/grow-directory.js` (30.09.2026: 601 media named, 316 main feeds kept; 480 media read, 112 sections kept; a few minutes); after that, the server looks at
`DIRECTORY_PER_RUN` more of each kind after each run of the background work, and the feeds it adds are
read by the next run.

Two addresses were added to the ones `findFeeds` tries when a site declares no feed, the ones of two
publishing systems many newspapers use without saying so: Arc (`/arc/outboundfeeds/rss/?outputType=xml`,
inquirer.com) and the one of Reach (`/?service=rss`, mirror.co.uk).

Measured again on the same 15 sentences, the same day: the media we read went from 564 to 880, and the
share of the first 30 news of Google told by a medium we read from 42% to 51%. But the share of those
news our feeds brought only went from 12% to 14%: a main feed carries the last 20 to 100 news of its
medium, a fraction of what it publishes. The answers grew where our sources had the subject (new
electric models 17 to 21, the budget and the pensions 5 to 10, Taylor Swift 17 to 27, with the release
of her new songs that was missed); a subject nobody follows is reached by asking Google News the
sentence (see **How a search works**), not by the directory.

The first read of the new feeds brought 21,935 news, the last 20 to 100 of each. Their vectors took a
few minutes on the graphics card, but grouping the 12,000 of the last 48 hours into stories goes at about
75 news a minute, more than two hours, while the lock of the background work is held.

#### RSS-Bridge

Some news sites publish no feed at all. RSS-Bridge reads their page and gives back its articles.
It runs next to the server:

```
docker compose up -d        # starts it on 127.0.0.1:3002
docker compose logs -f      # reads what it does
```

It is hosted here rather than used through a public instance: a public one answers `HTTP 500` as
soon as several feeds are asked at the same time, and a refresh reads 50 feeds at once. Only
`CssSelectorBridge` is enabled and the port is bound to the loopback address: the container is not
meant to be reachable from anywhere else. Its configuration is `docker/rss-bridge/config.ini.php`,
where every key must exist in the default configuration of RSS-Bridge, or every request answers
`500 Config [...] is invalid`.

A feed built this way is a scraper: it breaks the day the site changes its pages. The server only
keeps one when the articles have a real headline and a date, so a wrong reading is refused instead
of filling the cache with menus and contact pages.

### The briefing

A reader writes a profile in their own words ("I follow rugby and fashion, no football") and the
languages they read. The AI splits it once, when it is saved, into at most 6 **interests**, each with
its own vector, a weight, keywords to find media and short searches for Google News. One vector per
interest and not one for the whole profile: the average of rugby and fashion is football, and the words
a reader refuses pull it.

A briefing is written in background (`services/briefing-service.js`): the answer is the briefing still
running, the client asks for it again until it is ready, one at a time per reader. It reads only the
stories built by the background work, and goes through these steps:

1. **Ranking**, in SQL (`rank_stories` in `db/add_briefing.sql`). The news of the last 48 hours of the
   feeds of the reader (the shared ones of their languages, their own sources, the searches of Google
   News of their interests, without the sources their thumbs left out), in the languages they read.
   Each news scores its best interest, weight × (dense + 0.5 × sparse) of its title and the start of
   its description, and a story scores its best news. A story already shown can come back: the reader
   passes it, and leaving out every card shown left fewer news to choose from. A story told by a source the reader trusts gets a small bonus, among the 60 closest only: a
   trusted source never brings a story far from the profile. The AI chooses from the 40 best stories
   told by a feed, and at most 10 known only through Google News (see **Google News** below).
2. **Choosing.** The AI reads the candidates against the whole profile, with the cards the reader
   gave a thumb as examples, and chooses up to 15. The refusals of the profile are left to it: as
   vectors they removed good stories with the bad. Then each interest gets its share of the 10 places,
   by its weight, and the places left go to the next stories of the AI (`balanceSelection`): asked for
   ten, it gave most of them to the strongest interest.
3. **Checking**, two calls sent together (`services/utils/profile-ai.js`). `checkStories`: which
   articles of each story tell the news of its best one, up to 12 read per story, one per medium first;
   the card counts and lists only those. `mergeStories`: two cards telling the same news become one. If
   the AI fails, the stories are shown as the vectors grouped them: the check never costs the briefing.
4. **Reading.** Up to 5 articles per story, one of a source the reader trusts first, then one per
   medium. The real address of a news of Google News is asked only for the stories no feed lets read.
5. **Key passages** of the first article read in full, translated for a reader of another language
   (see **Key passages** above), and who wrote the story apart from the others (see **Corroboration**).
6. **Review.** The cards are read once more with their passages, which say what a title may not, and
   the ones on what the reader refuses are left out.

Measured on four profiles and 249 stories judged by hand: one vector per interest gave 88% of relevant
cards, and 95% once the AI chose among the 40 best. One vector for the whole profile gave 38%, worse than
the keywords of the search page. The tokens and the seconds of each step are logged with every briefing.

### Google News

Google News indexes far more media than `db/rss-links.js`, and every news of its RSS names its
publisher in clear (`<source url="https://www.bbc.com">`). It is used three ways
(`services/utils/google-news.js`):

- **the searches of the interests**, read like feeds by the background work: one feed per search the AI
  wrote for an interest ("fr:arbitrage football"), in the languages of the reader, on the last 2 days.
  The same search of two readers is one feed, read once. They never go in the sources of a reader: they
  say what their reader follows. Measured on the UEFA profile over 48 hours, its searches gave 676
  news, 158 stories the feeds did not have, and 91 more media on 22 of the stories they had;
- **the media that write on a subject**: the ones a search missed (see **Missing sources** above), and
  the ones a week of news of an interest names, to find the sources of a profile
  (`services/discovery-service.js`);
- **the real address of an article**, which Google hides behind a redirect: one page of Google each,
  so it is asked only when a briefing reads the article, at most 10 per briefing and 2 per story, and
  kept once found.

#### Media Cloud

The discovery of the sources of a profile (`services/discovery-service.js`) also asks
[Media Cloud](https://search.mediacloud.org), which indexes the national and regional press of each
country and searches the whole text of its news (`services/utils/media-cloud.js`). Its searches are the
ones of the interests, every word asked and in their language, over the last 30 days, in the press of that
language (France, Switzerland and Belgium for French). A medium it names that Google News did not is
tried after the media of Google, with a budget of its own (2 kept or 3 tried per language), and the
feeds its directory knows for it are candidates with the ones the site declares.

Measured on three profiles (5 media only it named tried per interest and language): 8 feeds on the
subject of 11 for the UEFA profile (blick.ch/fr, sudinfo.be, lesoir.be, onzemondial, the sport of the
Evening Standard), 3 of 10 for astronomy (lalibre.be sciences-espace), none for sailing and 2 of 20 for
the trading cards: it knows no specialist site. It answers 2 searches a minute, so its searches wait in
a queue of their own while the media of Google News are tried, and a refusal pauses it 15 minutes.

The medium of a news read through Google News is the publisher it names, not google.com
(`db/add_google_news.sql`): two media telling a story through Google are two voices, and a medium met
again through its own feed is the same one. The posts of social networks and videos, and the pages that
are no news (a league table, a live blog, where to watch a match), are left out. So is, from the
briefing, a story told only by one title one medium republished over hours (3 links over 2 hours at
least): the page of a section ("Football : Ligue 1 McDonald's" of canalplus.com), not a news.

Google News is no official API: asked too often from one address it answers 429 or a captcha. So every
request of the server to Google goes through one queue, never two closer than `GOOGLE_NEWS_INTERVAL_MS`;
each search is read again after `GOOGLE_NEWS_EVERY_MINUTES`, at most 60 per run; and the first sign of a
block pauses them for an hour. The article pages are blocked the soonest (after about 40 requests
in an hour), which is why they are kept so few. Google limits them apart from the searches (a 429 on
an article page while the searches still answered, 30.09.2026): a block of an article page pauses only
the real addresses, a block of a search pauses everything.

Its news get a place of their own in the briefing. On the UEFA profile, the stories told only
through Google took 30 of the 40 places: their titles are made of the words of the interests ("UEFA
Champions League live streams", ticket pages), while the real news among them were few. So the AI chooses
from the 40 best stories told by a feed (they may have gained media through Google), plus at most 10
told only through Google, 2 of one medium at most. A story known only through Google also needs two
media, or one medium the server reads through its own feed: a search also names spam sites written by
machines.

[//]: # (How to set up the database?)

[//]: # (How do you set the sensitive data?)

## Deployment

The background work reads the feeds every 20 minutes, day and night: it runs on a machine that stays
on, with the database, in Docker (`deploy/compose.yml`):

| Container | What | Listens on |
|---|---|---|
| `newsgenerator-db` | PostgreSQL 18 + pgvector, 2 GB of `shared_buffers` | the address of the machine, port 5433 |
| `newsgenerator-api` | this server and its background work (`Dockerfile`) | the address of the machine, port 3001 |
| `newsgenerator-rss-bridge` | RSS-Bridge | the API only (`http://rss-bridge`) |
| `newsgenerator-embedder` | the embedder on the processor (`embedder/Dockerfile`), started apart | the address of the machine, port 8020 |

Split over two machines, the database on a laptop and the embedder on another, everything stopped
as soon as either one did: on the night of 1.10 the laptop restarted for an update at 3:36, then slept
until noon, and no feed was read for 8 hours. Together on one machine, the graphics card of another
one stays first in `EMBEDDER_URL` when it is on, the embedder of the machine takes over when it is off.

Next to the code, in `~/newsgenerator` on the machine, readable by its owner only and never sent with
the code: `db.env` (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`) and `api.env`, the `.env` of
the server with `DATABASE_URL` to `db:5432` and `RSS_BRIDGE_URL=http://rss-bridge`.

To send the code and start it again (from any machine reaching it by ssh):

```bash
bash deploy/deploy.sh
```

A change of `db/*.sql` is run by hand on the database, as on the first install. While coding on
another machine, the server run by hand reads the same database (`DATABASE_URL` to the machine,
port 5433) with `INGEST_IN_SERVER=false`: the background work stays on the machine that stays on.

[//]: # ([### 1.3.1. On dev environment)

[//]: # ()
[//]: # (How to get dependencies and build?)

[//]: # (How to run the tests?)

[//]: # ()
[//]: # (### 1.3.2. On integration environment)

[//]: # ()
[//]: # (How to deploy the application outside the dev environment.])

## Directory structure

```shell
|-- bench                   # the benches of the measures quoted here, local only: not in git
|-- config
|-- controllers
|-- db                      # SQL scripts (with assign_stories and rank_stories) and the shared list of feeds (rss-links.js)
|-- deploy                  # the containers of the machine that stays on (compose.yml) and deploy.sh, which sends the code there
|-- docker
|   `-- rss-bridge          # configuration of the RSS-Bridge container
|-- docs
|   |-- UML
|-- embedder                # bge-m3 vectors over HTTP, in Python (server.py, requirements.txt)
|-- generated
|-- models
|-- prisma
|-- routes
|-- scripts                 # offline tools, run by hand, never by the server (ingest.js and ingest-status.js: pnpm run ingest, grow-directory.js)
|-- server.js
|-- services                # search, briefing, background work (ingest-service.js), sources, profiles
|   `-- utils               # key passages (extract.js), search by meaning (search-ai.js), Google News, embedder client...
`-- tests
    |-- briefing            # corroboration, key passages, interests, shares of the interests, stories, vectors, thumbs
    |-- custom-search
    |-- data
    |-- dates
    |-- feeds
    |-- filtering
    |-- grouping            # average link of the search list
    |-- links
    |-- login
    |-- mock
    |-- parser
    |-- search              # search by meaning, reading order of a card
    `-- sources
```

## Collaborate

If you have a suggestion that would make this better, 
please fork the repo and create a pull request. 
You can also simply open an issue with the tag "enhancement". More info on
[how to commit](https://www.conventionalcommits.org/en/v1.0.0/) and [how to use my workflow](https://nvie.com/posts/a-successful-git-branching-model/)

**Propose new feature:**

1. Fork the Project
2. Create your Feature Branch (git checkout -b feature/AmazingFeature)
3. Commit your Changes (git commit -m 'Add some AmazingFeature')
4. Push to the Branch (git push origin feature/AmazingFeature)
5. Open a Pull Request

## License

This project is under [MIT License](https://en.wikipedia.org/wiki/MIT_License). See more under `LICENCE.md`

## Contact

Can contact me on discord: fab2y