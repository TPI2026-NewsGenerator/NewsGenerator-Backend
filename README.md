# NewsGenerator-Backend

## Description

It is a personalizable news generator. <br>
It must be able to read the news, understand it, and show the key passages of the news it has read, taking
into account user parameters such as keywords, desired/undesired topics, language and timeframe of the search.
It also writes a daily briefing for each user, from a profile written in their own words (see
[Briefing](docs/briefing/README.md)).

In a few lines, from A to Z: in background, every minute, the server reads thousands of feeds and
searches of Google News, gives each news its bge-m3 vectors and its names (people, organisations,
places), and groups the news of several media telling one fact into a story, the stories of one affair
into a thread. A reader writes their profile with the AI's questions; the AI splits it into interests,
and the server finds sources for them. On demand, a briefing ranks the stories of 1 to 7 days on those
interests in SQL, the AI chooses and checks them, the articles are read, and each card shows the
article's own sentences (key passages, points or a summary), who tells it, its other angles, its
official source, an AI analysis, and the news of the names the profile follows. An administrator can
send the cards by e-mail. [`docs/a-to-z/`](docs/a-to-z/parcours-newsgenerator.md) tells it step by step,
and the diagrams of `docs/` draw it all (see **Documentation**).

Because it reads hundreds of media at once, it also says how widely a news is carried and how its
article credits its sources. That describes what was measured, never whether the news is true.

## Tech Stack

[Node.js](https://nodejs.org/) 24 and [Express](https://expressjs.com/) 5, [PostgreSQL](https://www.postgresql.org/)
17 or later with `pg_trgm`, `unaccent` and [pgvector](https://github.com/pgvector/pgvector), [Prisma](https://www.prisma.io/),
[Ollama](https://ollama.com/) (gemma4:31b for most calls, deepseek-v4-pro for the two texts the AI writes itself), the
bge-m3 vectors and the GLiNER tagger of the names as two small Python processes of their own (`embedder/`, `ner/`),
[Wikidata](https://www.wikidata.org), [Crawlee](https://crawlee.dev/js), [RSS-Bridge](https://rss-bridge.org/) and
[Nodemailer](https://nodemailer.com/). Every tool with its exact version, what it is for and where it is in the code:
[`docs/tools.md`](docs/tools.md); the choices and their reasons: [`docs/setup.md`](docs/setup.md).

## Getting Started

Prerequisites: Node.js 24, [pnpm](https://pnpm.io/fr/), Python with pip (for the embedder and the tagger) and PostgreSQL
17 or later with pgvector. Everything else, step by step (Ollama, the embedder, the tagger, the database scripts in
their order, the `.env`), is in [Installation and configuration](docs/setup.md).

```bash
pnpm install
cp .env.example .env      # then fill it: the database, the Ollama key, the secrets (see docs/setup.md)
pnpm run server           # http://localhost:3001, the background work starts with it
```

The database is made by running the scripts of `db/` in the order `docs/setup.md` gives (`create_insert_NewsGenerator.sql`
first, then each `add_*.sql`); a database already in service is brought up to date by running the missing ones.
`pnpm test` runs the tests, `pnpm run ner:status` says where the tagging of the names stands.

## Documentation

The documentation of the server and of the client is one site, built with [MkDocs](https://www.mkdocs.org) from the
Markdown and the diagrams of `docs/` and of `../client/docs/`: a menu by feature, a search, the diagrams in the pages.
The Markdown is the source and reads the same on GitHub. From `server/`:

```bash
pnpm run docs          # the site on http://127.0.0.1:8000, rebuilt at each change (makes .venv-docs/ the first time)
pnpm run docs:build    # the site in site/, failing on a broken link or a version of docs/tools.md not installed
pnpm run docs:zip      # NewsGenerator-docs.zip, the site read without a server: to send it, unzip it, open index.html
```

On the deployed site it is served on `/docs`, for the readers signed in only (see [Deployment](docs/deployment.md)).
Where to look:

| Where | What |
|---|---|
| [`docs/README.md`](docs/README.md) | where to start, and the list of every feature and of its parts |
| [`docs/a-to-z/`](docs/a-to-z/parcours-newsgenerator.md) | how the whole system works from A to Z, in French: the walk of a reader, the walk of one news |
| `docs/<feature>/` | one folder per feature (Accounts, Profile, Sources, Ingestion, Search, Briefing, Following), its overview and a folder per part of it, with class and sequence diagrams |
| [`docs/setup.md`](docs/setup.md), [`docs/deployment.md`](docs/deployment.md) | installing and configuring the server, and hosting it on the machine that stays on |
| [`docs/tools.md`](docs/tools.md), [`docs/database/mld.md`](docs/database/mld.md) | every tool and its version; the 25 tables and the SQL functions |
| `http://localhost:3001/docs` | every route, with its body and its answers (Swagger UI), written in `config/swagger.js` |
| [`docs/archive/`](docs/archive/readme-features-2026-10-24.md) | the sprint diagrams, and the long README of 24.10.2026, kept as it was |
| `../client/docs/` | the use cases, and the client's pages and components by feature |

## Deployment

The database, the API with its background work, the web server and RSS-Bridge run in Docker on a machine that stays on,
reached through a tunnel; `bash deploy/deploy.sh` builds the client, sends it with the code and starts them again. The
containers, their settings and what stays on the machine: [Deployment](docs/deployment.md).

## Directory structure

```shell
|-- bench                   # the benches of the measures quoted in the docs, local only: not in git
|-- config
|-- controllers
|-- db                      # SQL scripts (with assign_stories and rank_stories) and the shared list of feeds (rss-links.js)
|-- deploy                  # the containers of the machine that stays on (compose.yml) and deploy.sh, which sends the code there
|-- docker
|   `-- rss-bridge          # configuration of the RSS-Bridge container
|-- docs                    # README.md says what each folder holds
|   |-- A to Z              # how the whole system works: the walkthroughs (Parcours *.md / .html), the A to Z, overview and deployment diagrams
|   |-- accounts, profile, sources, ingestion, search, briefing, following
|   |                       # one folder per feature, a folder per part of it (briefing/summary/summary-ia...)
|   |-- Archive             # the MCD, MLD and class diagrams of sprints 1 to 3, and the former long README
|   |-- Database            # the MLD and its diagram
|   `-- _style              # the style the diagrams include
|-- embedder                # bge-m3 vectors over HTTP, in Python (server.py, requirements.txt)
|-- generated
|-- models
|-- ner                     # the tagger of the names of the news over HTTP, GLiNER in Python (server.py)
|-- prisma
|-- routes
|-- scripts                 # offline tools, run by hand, never by the server (ingest.js and ingest-status.js: pnpm run ingest, grow-directory.js)
|-- server.js
|-- services                # search, briefing, background work (ingest-service.js, tagging-service.js), sources, profiles, items followed
|   `-- utils               # key passages (extract.js), search by meaning (search-ai.js), analysis (card-analysis.js), official sources, e-mail, Google News, embedder and tagger clients...
`-- tests
    |-- briefing            # corroboration, key passages, interests, shares of the interests, stories, vectors, thumbs
    |-- custom-search
    |-- data
    |-- dates
    |-- entities            # items followed, names of the news
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
