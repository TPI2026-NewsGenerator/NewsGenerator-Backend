# NewsGenerator-Backend

## Description

It is a personalizable news generator. <br>
It must be able to read the news, understand it, and summarize the news it has read, taking into account
user parameters such as keywords, desired/undesired topics, language and timeframe of the search.

Because it reads hundreds of media at once, it also says how widely a news is carried and how its
article credits its sources. That describes what was measured, never whether the news is true.

## Tech Stack

- [Node.js](https://nodejs.org/) [v22.18.0]
- **Server:** [Express](https://expressjs.com/) [v5.2.1]
- **AI Orchestration:** [Ollama](https://ollama.com/) [v0.6.3]
- **Scraper:** [Crawlee](https://crawlee.dev/js) [v3.16.0]
- **Parsers:**
  - HTML: [LinkeDOM](https://www.npmjs.com/package/linkedom) [v0.18.12] and [Readability](https://github.com/mozilla/readability) [v0.6.0] to extract content
  - XML: [fast-xml-parser](https://www.npmjs.com/package/fast-xml-parser) [v5.3.5]
- **Security**
  - [JsonWebToken](https://www.npmjs.com/package/jsonwebtoken) [v9.0.3] for JWT creation
  - [bcrypt](https://www.npmjs.com/package/bcrypt) [v6.0.0] for password hashing
- **Database**
  - [PostgreSQL](https://www.postgresql.org/) [v18.3-3], with the `pg_trgm` extension for the keyword
    search and for grouping the news telling the same story
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

The scripts are in this order on purpose: each one only adds what the one before did not create, so a
database already in service is brought up to date by running the missing ones, without losing its cache.

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

### Documentation

| Where | What |
|---|---|
| `http://localhost:3001/docs` | every route, with its body and its answers (Swagger UI). It is written in `config/swagger.js`, which is the only source: there is no `.yaml` to keep in step with it |
| `docs/MLD_sprint4.md` | the eight tables, their columns and their keys, to redraw the MLD |
| `docs/UML/class-diagram-backend-sprint4.puml` | the class diagram, as source. Render it with `java -jar plantuml.jar docs/UML/class-diagram-backend-sprint4.puml` |
| `docs/*.png` | the MCD, MLD and class diagrams of sprints 1 to 3, kept as they were |

### How a search works

1. The feeds of `db/rss-links.js` are grouped by language, then by category (world, press, sport,
   politics, economy, technology, science). The user chooses the language and the categories, that
   is the first filter. There are 419 feeds: 339 in English, 25 in French, 20 in Spanish, 20 in
   German, 15 in Italian. A search never mixes two languages, and one in French has no reason to
   fetch the English sources.
2. A search fetches the feeds only when the cache is older than `FEED_MAX_AGE_MINUTES`, then reads
   the `articles` table. No feed is fetched in background. The shared feeds of a language and the
   sources added by a user are two separate groups: the sources of a user are read when that user
   searches, not when anybody else does.
3. Keywords, excluded keywords and the timeframe are applied in SQL. Keywords work like on Google:
   commas separate alternatives (OR), the words of an alternative must all be found (AND),
   `"quoted text"` is an exact word or phrase and `-word` excludes.

   Asking for every word at once is strict: `referee football soccer` wants the three of them in the
   same news, and almost none has all three. So when a search finds fewer than five news, the wider
   search asking for *any* of the words is counted and **offered**, not done — widening `red card`
   on its own would answer everything about red or about card. See `canWiden` and `widen` in
   `services/utils/filter.js`.
4. News telling the same story are grouped: one card, with the other sources listed under it. Two
   titles tell the same news above **0.30** of trigram similarity — under 40 characters the stricter
   **0.45** is kept, because a short title is mostly the template its paper puts around it and
   trigrams cannot tell "Health Care Roundup: Market Talk" from "Auto & Transport Roundup: Market
   Talk". Both constants, and what they were measured on, are at the top of `services/news-service.js`.
5. Each card says what the grouping measured, and nothing more (see **Corroboration** below).
6. A user can add their own sources (`POST /api/feeds` with a site address): the server finds the
   RSS feed of the site and checks it answers. These sources are **private**, they are only used in
   the searches of this user. Addresses of private networks are refused, see `services/utils/public-url.js`.
   The feed of a site is looked for in four steps, each one tried only when the one before found
   nothing (`services/utils/feed-finder.js`):
   1. the feed the page declares, `<link rel="alternate" type="application/rss+xml">`;
   2. the usual paths, `/rss`, `/feed`, `/rss/news`...;
   3. a directory of feeds, which knows the ones a site declares nowhere and that are on no usual
      path (`feed-directory.js`): this is what finds football.london and uefa.com;
   4. the site read as a page and turned into a feed by RSS-Bridge (`feed-bridge.js`), for the news
      sites that publish none at all: goal.com, onefootball.com, realmadrid.com.

   On 30 media that searches were missing, 17 publish a feed, 6 more are reached by step 4, and 7
   answer 401 or 403 to any server and stay out of reach (Reuters, AP, Man City).
7. The media the search missed are named to the user, so the list of sources grows from what the
   searches actually lacked (see **Missing sources** below).
8. Ollama is called **only** on the news selected by the user, and gives the resume, the topic and
   the sourcing of the news in one call. All three are saved, so asking the same resume twice costs
   nothing.

Optional variables in `.env`:

| Variable | Default | Description |
|---|---|---|
| `FEED_MAX_AGE_MINUTES` | 30 | A search refreshes the feeds when the cache is older than this |
| `FEED_RETENTION_DAYS` | 30 | Articles older than this are deleted |
| `RSS_BRIDGE_URL` | _(none)_ | Address of the RSS-Bridge, step 4 above. Empty: the sites without a feed are simply out of reach |

#### Corroboration

The project scrapes many media at once, so it can say how widely a news is carried. It says that,
and refuses to say anything else: **a rumour repeated by twenty sites is still a rumour**, and no
number here means a news is true.

Four things are shown next to a news, each one measured, none of them a verdict:

| Shown | Where it comes from |
|---|---|
| `N media` | how many different media the group holds, counted per medium and not per feed (`mediumOf`) |
| `M wordings` | the same titles grouped a second time at 0.85, which is the threshold of the same text: a wire of Reuters republished by twenty sites gives twenty media but one wording, and that is one report seen twenty times, not twenty confirmations. Never more than `N`. |
| `says "reportedly"` | the words the article itself used to say it has no confirmation (`services/utils/hedging.js`). It reports how the article presents itself, and the article's own words are shown rather than a label. Conditionals are left out: French and Italian use them for ordinary reported speech. |
| `named` / `unnamed` / `no source given` | who the article credits, answered by the AI with the resume, so it costs no extra call. It describes the article, never the truth of the news: an official statement can be a lie and an unnamed source can be right. |

A group of one medium says `this source only`, which is the honest answer and not a warning.

#### Missing sources

A search only finds what the sources publish, so the sources are grown from what the searches
actually missed, not from a list decided in advance. After a search, the same keywords are asked to
two public directories, and the media they name that are not in the cache are shown to the user:

- **Google News**, whose RSS gives the publisher of each result in clear (`services/utils/google-news.js`);
- **GDELT**, the DOC 2.0 API, as a second opinion (`services/utils/gdelt.js`).

Their news are shown **read-only** — the pages are not scraped and the AI never sees them, they are
only there to show what the search did not have. Next to them, the media whose feed was found can be
added in one click, and they become private sources of that user.

Which media are already searched is decided on the links of the articles, not on the addresses of
the feeds: a feed is often served from another domain than the site it publishes
(`feeds.bbci.co.uk` for bbc.com, feedburner for anybody), so comparing feed addresses would suggest
media that are in fact already read.

GDELT answers slowly and rate-limits: `fetch()` gives up at 10 seconds whatever timeout is asked, so
these calls use `node:https`, where the timeout is really honoured. A search waits 6 seconds at
most, and gets no suggestion from GDELT rather than a slow answer; the offline script below waits
30 seconds and retries.

Three scripts do the same work without anybody waiting:

```bash
node scripts/check-coverage.js "referee" sport      # what the cache finds vs what Google News finds
node scripts/find-feeds.js https://www.skysports.com # the feed of one site, to fill db/rss-links.js
node scripts/find-missing-sources.js --days 3       # sweeps the accumulated missing media, by batches
```

`find-missing-sources.js` separates what it finds: the media that publish a real feed are printed
ready to paste into `db/rss-links.js`, and the ones that only work through RSS-Bridge are printed
apart. The second group is deliberately **not** put in the shared catalogue, which would make it
depend on Docker being up; they are meant to be added as user sources.

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

[//]: # (How to set up the database?)

[//]: # (How do you set the sensitive data?)

## Deployment

To run for production:

```bash
pnpm run build
```

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
|-- config
|-- controllers
|-- db                      # SQL scripts and the shared list of feeds (rss-links.js)
|-- docker
|   `-- rss-bridge          # configuration of the RSS-Bridge container
|-- docs
|   |-- UML
|-- generated
|-- models
|-- prisma
|-- routes
|-- scripts                 # offline tools, run by hand, never by the server
|-- server.js
|-- services
|   `-- utils
`-- tests
    |-- custom-search
    |-- data
    |-- dates
    |-- feeds
    |-- filtering
    |-- links
    |-- login
    |-- mock
    |-- parser
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