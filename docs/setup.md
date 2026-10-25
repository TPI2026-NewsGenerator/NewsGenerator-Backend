# Installation and configuration

How to install, configure and run the server on a machine of your own, and how to build this documentation.
How the server is hosted on the machine that stays on is in [Deployment](deployment.md); the pages by
feature (Ingestion, Search, Briefing...) say what it does.

## Tech stack


Every tool, its exact version and where it is used: [`tools.md`](tools.md) (checked against `node_modules` at each build of the docs).

- [Node.js](https://nodejs.org/) [v24] (`node:24-slim`; 24.21.0 on the laptop)
- **Server:** [Express](https://expressjs.com/) [v5.2.1]
- **AI Orchestration:** [Ollama](https://ollama.com/) [v0.6.3], Ollama cloud by default or an Ollama server
  of our own (`OLLAMA_HOST`)
  - model: gemma4:31b (`OLLAMA_MODEL` to change it). Measured against
    gpt-oss:20b, gpt-oss:120b and nemotron-3-nano:30b: the best choice and check of the stories, and 5 to 10
    times fewer tokens, because it does not reason before answering. It can be hosted on one GPU.
  - fallback: the same model on the [Gemini API](https://ai.google.dev/) (gemma-4-31b-it, free), asked
    when Ollama fails or does not answer within 120 s (`AISTUDIO_API_KEY`, see [Ollama](#ollama))
  - deepseek-v4-pro:0813 for the two texts the AI writes itself, the AI version of a card
    (`OLLAMA_WRITE_MODEL`) and the analysis of the cards (`OLLAMA_ANALYSIS_MODEL`): fewer meaning errors
    and clearer than gemma4:31b where it was measured, at about 11 times its cost; no Gemini after it
- **Names of the news:** [GLiNER](https://github.com/urchade/GLiNER) multi v2.1, a Python process of its
  own (`ner/`, see [Tagger](#tagger)), and [Wikidata](https://www.wikidata.org) for the items followed
- **E-mail:** [Nodemailer](https://nodemailer.com/) through an SMTP account (`services/utils/mailer.js`)
- **Vectors of the news:** [bge-m3](https://huggingface.co/BAAI/bge-m3), dense and sparse, computed by a
  Python process of its own (`embedder/`, see [Embedder](#embedder)): [FlagEmbedding](https://github.com/FlagOpen/FlagEmbedding)
  and [PyTorch](https://pytorch.org/) on a graphics card, [ONNX Runtime](https://onnxruntime.ai/) on a
  processor (the same vectors, 1.6 times faster). Ollama serves bge-m3 too, but only its dense vector.
- **Scraper:** [Crawlee](https://crawlee.dev/js) [v3.16.0]
- **Parsers:**
  - HTML: [LinkeDOM](https://www.npmjs.com/package/linkedom) [v0.18.12] and [Readability](https://github.com/mozilla/readability) [v0.6.0] to extract content
  - XML: [fast-xml-parser](https://www.npmjs.com/package/fast-xml-parser) [v5.7.2]
- **Security**
  - [JsonWebToken](https://www.npmjs.com/package/jsonwebtoken) [v9.0.3] for JWT creation
  - [bcrypt](https://www.npmjs.com/package/bcrypt) [v6.0.0] for password hashing
- **Database**
  - [PostgreSQL](https://www.postgresql.org/) [v18.6] (17 at least, see `db/add_google_news.sql`), with:
    - `pg_trgm`, for the keyword search and for grouping the cards of a search list
    - `unaccent`, to compare the titles without their accents
    - [pgvector](https://github.com/pgvector/pgvector), for the bge-m3 vectors: the stories of the briefing,
      the ranking of the interests and the search by meaning are computed in SQL, where the vectors are
  - [Prisma](https://www.prisma.io/) [v7.10.0] as the client
- **Feeds of the sites that publish none:** [RSS-Bridge](https://rss-bridge.org/), self-hosted with
  Docker (optional, see [Feeds](ingestion/feeds/README.md))


## Prerequisites

List all dependencies and their version needed by the project as :

[//]: # (* DataBase Engine &#40;MySql, PostgreSQL, MSSQL,...&#41;)
* [Node.js](https://nodejs.org/) [v24]
* IDE used: [IntelliJ](https://www.jetbrains.com/idea/) [v2025.3.3]
* Package manager: [pnpm](https://pnpm.io/fr/) [v10.33.2]
* [Python](https://www.python.org/) with pip, for the embedder (`embedder/requirements.txt`)
* [PostgreSQL](https://www.postgresql.org/download/) 17 or later, with [pgvector](https://github.com/pgvector/pgvector)
  installed on the database server
* OS supported: All (web based)

[//]: # (* Virtualization &#40;Docker, .Net, .JDK, .JRE&#41;)

## Configuration
### Ollama

1. Visit Ollama [website](https://ollama.com/), create an account and create an API Key
under `Settings -> Keys -> Add API Key`

2. Rename `.env.example` to `.env` and insert you api key file:
```
OLLAMA_API_KEY=your_api_key
```

3. Optional: `OLLAMA_MODEL` changes the model (gemma4:31b by default), `OLLAMA_HOST` names an Ollama server
of our own instead of Ollama cloud (`http://127.0.0.1:11434`), which needs no key.

4. Optional: `AISTUDIO_API_KEY`, a key of [Google AI Studio](https://aistudio.google.com/apikey) (free): the
same model on the Gemini API answers when Ollama fails (`services/utils/ollama.js`). A refused quota or
key leaves Ollama aside for 15 minutes, a service down only that call. A fallback only: measured on 8
calls, 30 to 86 s each where Ollama answers in 1 to 7, 2 of them an immediate error 500 (asked again
once), and its JSON mode answers an error 500 for this model. The free tier lets Google read the prompts.

5. The whole server sends 6 calls at once to Ollama at most (`OLLAMA_CONCURRENCY`): Ollama cloud takes
6 and refuses the next ones at once (`bench/ollama-concurrency.mjs`, 14.10.2026), which lost the angles
of a card. A call is given up after 120 s and asked of Gemini; Ollama answering "too many concurrent
requests" is asked again after 2, 5 and 10 s. A call of deepseek-v4-pro waits longer (20 and 30 s more)
and never goes to Gemini: failing only gives up what it was for.

### Embedder

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
| `EMBEDDER_THREADS` | the threads of ONNX Runtime on a processor, one per core when not given |

and the `.env` of the server gives its address and the same secret:

| Variable | Default | Description |
|---|---|---|
| `EMBEDDER_URL` | `http://127.0.0.1:8020` | where the embedder answers. Several, separated by commas: every one that answers works at the same time, one off is asked again every minute (see below) |
| `EMBEDDER_TOKEN` | _(none)_ | the same secret as the embedder |
| `EMBEDDER_BATCH` | 16 | texts per request. On a busy processor 64 texts took up to 310 s, and `fetch` gives up at 300 s. A graphics card answers 16 texts in a fraction of a second: 128 saves the round trips. An embedder saying it runs on a processor always gets 16 |

The firewall of that machine should also let only the server reach the port. The vectors are computed in
fp32 on the card too, so they stay the ones of the processor, already stored and measured on the benches.

### Tagger

The names of the news (see [Names](ingestion/names/README.md)) come from `ner/server.py`, another small HTTP
server in Python. Without it, or without `NER_URL`, nothing is tagged and the pages search the texts.

```bash
pip install -r ner/requirements.txt
pnpm run ner             # listens on 127.0.0.1:8021, loads urchade/gliner_multi-v2.1 first
pnpm run ner:status      # where it stands: the taggers of NER_URL, news with their names, waiting ones, pace, time left, names in Wikidata
```

On another machine, `ner/.env` (or the environment) gives `NER_HOST`, `NER_PORT` (`8021`), `NER_TOKEN`
(the embedder's `EMBEDDER_TOKEN` is taken when it is not given) and `NER_THREADS`, as for the embedder.
On a machine without Python packages it runs in Docker (`ner/Dockerfile`, PyTorch for the processor):

```bash
docker build -t newsgenerator-ner:cpu ner
docker run -d --name newsgenerator-ner --restart unless-stopped --cpus 2 --cpu-shares 64 --memory 3g -p <its address>:8021:8021 --env-file token.env -e NER_THREADS=2 -v ./cache:/cache newsgenerator-ner:cpu
```

On the server it takes 2 cores at a low weight (`--cpu-shares 64`): the embedder (256), the site and
the other work of the machine pass first; with 3 cores it took the embedder from about 7 900 news an
hour to 5 300-5 900, the pace the news come at (13.10.2026). A graphics card tags about 130 news a
second. The `.env` of the server lists the taggers in `NER_URL`, separated by commas, and gives the same secret
(`NER_TOKEN`, or `EMBEDDER_TOKEN` when they share it). Each one that answers works on its own news.

### Database

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
20. Do the same with "add_directory.sql" (the feeds the server finds itself, see [Directory](ingestion/directory/README.md)),
    then run `node scripts/grow-directory.js` once to fill it
21. Do the same with "drop_profile_topics.sql" (the themes ticked with a profile, no longer used: the
    interests are read from its text alone)
22. Do the same with "add_profile_refused.sql" (what a reader says they do not want, shown on their
    profile; filled when a profile is saved again)
23. Do the same with "add_password_changed.sql" (a password changed in the settings ends the sessions
    of the other devices)
24. Do the same with "add_profiles.sql" (several profiles per reader, the terms each one follows, the
    cards a briefing was asked for). Its three parts in order: A adds, B fills the profile of what each
    reader had, C swaps the keys, right before deploying the server that uses them
25. Do the same with "add_directory_removed.sql" (the feeds the directory took out because they serve
    no reader, see [Directory](ingestion/directory/README.md))
26. Do the same with "add_briefing_window.sql" (the hours of news a briefing was written from)
27. Do the same with "add_article_repeats.sql" (a news a feed gives again under another link is found
    by its feed and its date before it is saved)
28. Do the same with "add_entities.sql" (the clubs, people and organisations followed, see [Following](following/README.md))
29. Do the same with "add_sent_mails.sql" (the copies of the e-mails sent before 13.10.2026, see [E-mail](briefing/email/README.md))
30. Do the same with "add_official_sources.sql" (the parties of a card and their own channels, for its
    official source), then "add_articles_medium_index.sql" alone (built without locking the ingestion)
31. Do the same with "add_projects.sql" (the projects of a profile, read by its briefing until their
    last day)
32. Do the same with "add_named_entities.sql" (the names each news names, see [Names](ingestion/names/README.md)), then "add_untagged_index.sql" alone (built without locking the ingestion)
33. Do the same with "add_follow_in_briefing.sql" (what a profile follows in one list, see [Following](following/README.md))
34. Do the same with "add_mentions_wanted.sql" (the names a reader sees looked for in Wikidata first)
35. Do the same with "add_briefing_analysis.sql" (the AI analysis of the cards of a briefing)
36. Do the same with "add_item_countries.sql" (the country of each item a card names, see [Names](ingestion/names/README.md)), then "add_item_bodies.sql" (the bodies of a person: the people of an international
    body a card names lose their country, the others do not)
37. Do the same with "add_mention_candidates.sql" (the items a name may be, kept for a card to choose
    among them)

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

### Environment
To install dependencies:
```bash
pnpm install
```

To start a development server:
```bash
pnpm run server
```


## Building this documentation

The documentation of the server and of the client is one site, built with [MkDocs](https://www.mkdocs.org)
and [Material](https://squidfunk.github.io/mkdocs-material/) from the Markdown and the diagrams of `docs/` and
of `../client/docs/` (the client repo next to this one): a menu by feature, a search, the diagrams in the
pages, zoomable. The Markdown stays the source and reads the same on GitHub. From `server/`:

```bash
pnpm run docs          # the site on http://127.0.0.1:8000, rebuilt at each change (makes .venv-docs/ the first time)
pnpm run docs:build    # the site in site/, failing on a broken link or a version of docs/tools.md not installed
pnpm run docs:zip      # NewsGenerator-docs.zip, the site read without a server: to send it, unzip it, open index.html
```

`mkdocs.yml` is its menu and its settings, `docs-site/hooks.py` adds the client's docs, shows the diagrams
and checks the versions of [`tools.md`](tools.md), `docs-site/requirements.txt` pins its Python packages.

| Where | What |
|---|---|
| [`tools.md`](tools.md) | every tool, its version, what it is for, where it is in the code, and which parts of the docs explain it |
| `http://localhost:3001/docs` | every route, with its body and its answers (Swagger UI). It is written in `config/swagger.js`, which is the only source: there is no `.yaml` to keep in step with it |
| `docs/README.md` | where to start, and the list of every feature and of its parts |
| `docs/a-to-z/` | how the whole system works, from A to Z: `parcours-newsgenerator.md` (`.html`, in French), the walk of a reader from the account to the reading of a card, every step with its mechanism and its technology; `parcours-d-une-nouvelle.md` (`.html`, in French), one news followed from the page of its medium to the card of a reader; `32-a-to-z` the same as one diagram, `00-overview` the features and what links them, `31-deployment` the machines |
| `docs/<feature>/` | one folder per feature: Accounts, Profile, Sources, Ingestion, Search, Briefing, Following. Its `README.md`, its overview class and sequence diagrams, and a folder per part of it (`briefing/summary/summary-ia/`, `search/key-passages/`...), each with a `README.md` (what it does and how: its routes, modules, tables, AI calls, limits and measures), a class diagram and a sequence diagram from the click of the reader to the database |
| `docs/database/` | `mld.md`, the twenty-five tables, their columns, their keys and the SQL functions (checked against the database in service, 16.10.2026, `item_countries` and the columns added since from their scripts), and `30-database`, the same as a diagram |
| `docs/archive/` | the MCD, MLD and class diagrams of sprints 1 to 3, and [the former long README](archive/readme-features-2026-10-24.md), kept as they were |
| `../client/docs/` | the use cases, and the client's pages and components by feature |

Every diagram is there as source (`.puml`) and as PNG. Render a folder again, from `server/`, with
`java -jar plantuml.jar -charset UTF-8 "docs/briefing/summary/summary-ia/*.puml"`; the class diagrams need
Graphviz (`dot`) for the layout they have. Without either, the official image has both: from `server/docs`,
`docker run --rm -u "$(id -u):$(id -g)" -v "$PWD":/data plantuml/plantuml -charset UTF-8 ingestion/names/*.puml`
(run on the Ubuntu server on 18.10.2026, PlantUML 1.2026.9, the files copied there and the PNG back).
