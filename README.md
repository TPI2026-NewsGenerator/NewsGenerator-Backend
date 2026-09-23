# NewsGenerator-Backend

## Description

It is a personalizable news generator. <br>
It must be able to read the news, understand it, and summarize the news it has read, taking into account
user parameters such as keywords, desired/undesired topics, language and timeframe of the search.

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
  - [PostgreSQL](https://www.postgresql.org/) [v18.3-3]

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

### How a search works

1. The feeds of `db/rss-links.js` are grouped by category (world, press, sport, politics, economy,
   technology, science). The user chooses the categories, that is the first filter.
2. A search fetches the feeds only when the cache is older than `FEED_MAX_AGE_MINUTES`, then reads
   the `articles` table. No feed is fetched in background.
3. Keywords, excluded keywords and the timeframe are applied in SQL. Keywords work like on Google:
   commas separate alternatives (OR), the words of an alternative must all be found (AND),
   `"quoted text"` is an exact word or phrase and `-word` excludes.
4. News telling the same story (same title at 45% or more, trigram similarity) are grouped: one card
   with the other sources listed.
5. A user can add their own sources (`POST /api/feeds` with a site address): the server finds the
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
6. Ollama is called **only** on the news selected by the user, and gives the resume and the topic of
   the news in one call. Both are saved, so asking the same resume twice costs nothing.

Optional variables in `.env`:

| Variable | Default | Description |
|---|---|---|
| `FEED_MAX_AGE_MINUTES` | 30 | A search refreshes the feeds when the cache is older than this |
| `FEED_RETENTION_DAYS` | 30 | Articles older than this are deleted |
| `RSS_BRIDGE_URL` | _(none)_ | Address of the RSS-Bridge, step 4 above. Empty: the sites without a feed are simply out of reach |

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
|-- db
|-- docs
|   |-- UML
|-- generated
|-- models
|-- prisma
|-- routes
|-- server.js
|-- services
|   `-- utils
`-- tests
    |-- custom-search
    |-- data
    |-- filtering
    |-- links
    |-- login
    `-- mock
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