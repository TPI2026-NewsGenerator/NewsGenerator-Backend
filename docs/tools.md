# Tools

Every tool NewsGenerator uses, its version, what it is for, where it is in the code, and which parts of the
documentation explain it. Versions as installed on 17.10.2026: the npm ones are read from `node_modules` when
the site is built, and the build fails when this page says another one (see `docs-site/hooks.py`); the others
come from the Dockerfiles, `compose.yml` and the database in service.

## AI models

| Model | Version | What for | Where in the code | Documented in |
|---|---|---|---|---|
| **gemma4:31b**, on [Ollama](https://ollama.com) cloud | `OLLAMA_MODEL` | every call of the AI but two: the questions and the profile written (`profile-funnel.js`); the interests of a profile, the choice of the stories, their check and merge, the review of the cards, the feeds confirmed on a subject (`profile-ai.js`); the verdicts of a search by meaning (`search-ai.js`); the key passages and the translations (`extract.js`); the denials (`contested.js`); the other angles (`other-angles.js`); the official sources and statements (`official-sources.js`, `statements.js`); the stories that evolved since sent (`repeats.js`) | `services/utils/ollama.js` (`ollamaJson`, 6 calls at once, 120 s a call) | [AI questions](profile/ai-questions/README.md), [Interests](profile/interests/README.md), [Search by meaning](search/search-by-meaning/README.md), [Key passages](briefing/key-passages/README.md), [Translations](search/translations/README.md), [Denials](briefing/denials/README.md), [Other angles](briefing/other-angles/README.md), [Official source](briefing/official-source/README.md), [Briefing](briefing/README.md) |
| **gemma-4-31b-it**, on the [Gemini API](https://ai.google.dev) | `GEMINI_MODEL` | the same model when Ollama fails or does not answer in 120 s (`AISTUDIO_API_KEY`) | `services/utils/ollama.js` | [Briefing](briefing/README.md) |
| **deepseek-v4-pro:0813**, on Ollama cloud | `OLLAMA_WRITE_MODEL`, `OLLAMA_ANALYSIS_MODEL` | the two texts the AI writes itself: the AI version of a card's points and summary (thinking off), and the analysis of the cards (choice thinking off, analysis thinking on). Never Gemini after it | `services/utils/ai-ways.js`, `services/utils/card-analysis.js` | [Summary (IA)](briefing/summary/summary-ia/README.md), [Bullet points (IA)](briefing/bullet-points/bullet-points-ia/README.md), [Analysis (IA)](briefing/analysis-ia/README.md) |
| **[bge-m3](https://huggingface.co/BAAI/bge-m3)** (BAAI) | 1024 dims + sparse | the dense and sparse vectors of every news, of the interests, of a sentence searched, of the feeds judged | `embedder/server.py` (Python), client `services/utils/embedder.js`, used by `ingest-service.js`, `news-service.js`, `profile-service.js`, `discovery-service.js`, `source-service.js`, `utils/meaning-judge.js` | [Vectors](ingestion/vectors/README.md), [Stories and threads](ingestion/stories-and-threads/README.md), [Interests](profile/interests/README.md), [Search by meaning](search/search-by-meaning/README.md) |
| **[GLiNER](https://github.com/urchade/GLiNER) multi v2.1** (`urchade/gliner_multi-v2.1`) | threshold 0.5 | the people, organisations and places each news names; the names a line of the analysis may cite | `ner/server.py` (Python), client `services/utils/tagger.js`, used by `tagging-service.js` and `utils/card-analysis.js` | [Names](ingestion/names/README.md), [Names on cards](following/names-on-cards/README.md), [Analysis (IA)](briefing/analysis-ia/README.md) |

The embedder and the tagger run on the graphics card of a PC when it is on, else on the processor of the
server (`EMBEDDER_URL`, `NER_URL`): [Vectors](ingestion/vectors/README.md), [31-deployment](a-to-z/31-deployment.png).

| Python library | Version | Where |
|---|---|---|
| [FlagEmbedding](https://github.com/FlagOpen/FlagEmbedding) | ≥ 1.3 | `embedder/server.py`, on a graphics card |
| [ONNX Runtime](https://onnxruntime.ai) | ≥ 1.20 | `embedder/server.py`, on a processor (1.6 times faster, the same vectors) |
| [PyTorch](https://pytorch.org) | ≥ 2.2 | `embedder/server.py`, `ner/server.py` |
| [gliner](https://pypi.org/project/gliner/) | ≥ 0.2.16 | `ner/server.py` |
| Python | 3.12 (Docker images) | `embedder/Dockerfile`, `ner/Dockerfile` |

## Reading the web (server)

| Tool | Package | Version | What for | Where in the code | Documented in |
|---|---|---|---|---|---|
| fetch of Node | — | Node 24 | the feeds (`Crawlers.Xml`, 50 at a time, 8 s each) and the pages first (`Crawlers.Pages`) | `services/utils/crawlers.js`, used by `feed-service.js`, `google-news.js`, `feed-bridge.js`, `official-sources.js` | [Feeds](ingestion/feeds/README.md) |
| [Crawlee](https://crawlee.dev/js) | `crawlee` | 3.16.0 | the article pages a plain fetch could not read (`CheerioCrawler`, in `Crawlers.Html`): techspot, ksl, k24 are read by it only; its logger is also silenced in `gdelt.js` | `services/utils/crawlers.js` (`Html`), used by `briefing-service.js` (step `reading`) and `news-service.js` (key passages of a search) | [Key passages (briefing)](briefing/key-passages/README.md), [Key passages (search)](search/key-passages/README.md) |
| [Readability](https://github.com/mozilla/readability) | `@mozilla/readability` | 0.6.0 | the text of an article out of its page, as the reader mode of Firefox | `services/utils/crawlers.js` | [Key passages](briefing/key-passages/README.md) |
| [LinkeDOM](https://github.com/WebReflection/linkedom) | `linkedom` | 0.18.12 | an HTML page as a DOM, for Readability and for finding feeds and sections | `crawlers.js`, `feed-finder.js`, `feed-bridge.js`, `site-sections.js`, `parser.js` | [Added by hand](sources/added-by-hand/README.md), [Directory](ingestion/directory/README.md) |
| [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) | `fast-xml-parser` | 5.7.2 | RSS and Atom feeds, news sitemaps | `services/utils/parser.js`, `scripts/import-awesome-feeds.js` | [Feeds](ingestion/feeds/README.md) |
| [franc](https://github.com/wooorm/franc) | `franc` | 6.2.0 | the language of a feed from its last 30 news, when the short words tell none | `services/utils/language.js` | [Feeds](ingestion/feeds/README.md) |
| [RSS-Bridge](https://rss-bridge.org) | — | `rssbridge/rss-bridge:latest` | a feed built from the page of a site that publishes none (`CssSelectorBridge`) | `services/utils/feed-bridge.js`, `docker/rss-bridge/`, `deploy/compose.yml` | [Added by hand](sources/added-by-hand/README.md) |
| Google News RSS | — | — | the searches of the interests, a sentence searched, the media a search missed, the real address of a news | `services/utils/google-news.js` | [Feeds](ingestion/feeds/README.md), [Search by meaning](search/search-by-meaning/README.md), [Missing sources](sources/missing-sources/README.md), [Discovery](sources/discovery/README.md) |
| [GDELT](https://www.gdeltproject.org) DOC 2.0 | — | — | a second opinion on the media a search missed | `services/utils/gdelt.js` | [Missing sources](sources/missing-sources/README.md) |
| [Media Cloud](https://search.mediacloud.org) | — | — | the national and regional press of a language, for the discovery (`MEDIACLOUD_API_TOKEN`) | `services/utils/media-cloud.js` | [Discovery](sources/discovery/README.md) |
| [Feedly](https://feedly.com) search | — | — | the feeds a site declares nowhere | `services/utils/feed-directory.js` | [Added by hand](sources/added-by-hand/README.md), [Directory](ingestion/directory/README.md) |
| [Wikidata](https://www.wikidata.org) (wbsearchentities, SPARQL) | — | — | the items followed and their links, the item a name is, the parties of an official source and their channels | `services/utils/wikidata.js`, `wikidata-names.js`, `official-sources.js`, `tagging-service.js` | [Wikidata items](following/wikidata-items/README.md), [Names](ingestion/names/README.md), [Official source](briefing/official-source/README.md) |

## Server

| Tool | Package | Version | What for | Where in the code | Documented in |
|---|---|---|---|---|---|
| [Node.js](https://nodejs.org) | — | 24 (`node:24-slim`) | the runtime of the API and of the background work | `Dockerfile` | [31-deployment](a-to-z/31-deployment.png) |
| [Express](https://expressjs.com) | `express` | 5.2.1 | the API | `app.js`, `routes/*` | every sub-feature |
| [cors](https://github.com/expressjs/cors) | `cors` | 2.8.6 | the CORS headers of the API (`cors()`, every origin) | `app.js`, `routes/router.js` | |
| [Ollama JS](https://github.com/ollama/ollama-js) | `ollama` | 0.6.3 | the calls to Ollama cloud | `services/utils/ollama.js` | see **AI models** |
| [Nodemailer](https://nodemailer.com) | `nodemailer` | 10.0.16 | the e-mail of a briefing, through an SMTP account (Gmail) | `services/utils/mailer.js` | [Email](briefing/email/README.md) |
| [bcrypt](https://github.com/kelektiv/node.bcrypt.js) | `bcrypt` | 6.0.0 | the passwords, 12 rounds | `services/utils/pwd-hasher.js` | [Signup](accounts/signup/README.md), [Login and session](accounts/login-and-session/README.md) |
| [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) | `jsonwebtoken` | 9.0.3 | the session, a token of 7 days in an HttpOnly cookie | `services/utils/jwt.js` | [Login and session](accounts/login-and-session/README.md) |
| [dotenv](https://github.com/motdotla/dotenv) | `dotenv` | 17.4.2 | the `.env` of the server | `server.js`, `config/*.js`, `scripts/*` | |
| [swagger-jsdoc](https://github.com/Surnet/swagger-jsdoc) | `swagger-jsdoc` | 6.2.8 | the OpenAPI description of every route | `config/swagger.js` | `http://localhost:3001/docs` |
| [swagger-ui-express](https://github.com/scottie1984/swagger-ui-express) | `swagger-ui-express` | 5.0.1 | Swagger UI at `/docs` | `app.js` | |

## Data

| Tool | Package | Version | What for | Where in the code | Documented in |
|---|---|---|---|---|---|
| [PostgreSQL](https://www.postgresql.org) | — | 18.6 (`pgvector/pgvector:pg18`) | the accounts, the cache of the news, the stories, the briefings | `db/*.sql`, `deploy/compose.yml` | [Database](database/mld.md) |
| [pgvector](https://github.com/pgvector/pgvector) | — | 0.8.6 | `vector`, `halfvec` and `sparsevec`: grouping (`assign_stories`, `assign_threads`) and ranking (`rank_profile_stories`) in SQL | `db/add_briefing.sql`, `db/add_threads.sql`, `db/add_projects.sql` | [Stories and threads](ingestion/stories-and-threads/README.md), [Briefing](briefing/README.md) |
| pg_trgm | — | 1.6 | the keyword search and the grouping of the news in no story | `db/add_articles_search.sql` | [Keywords](search/keywords/README.md) |
| unaccent | — | 1.1 | titles compared without their accents | `db/add_unaccent.sql` | [Keywords](search/keywords/README.md) |
| [Prisma](https://www.prisma.io) | `prisma` | 7.10.0 | the schema and the generated client | `prisma/schema.prisma`, `prisma.config.js` | [Database](database/mld.md) |
| Prisma adapter for pg | `@prisma/adapter-pg` | 7.10.0 | Prisma through `pg`, in UTC | `config/db.js` | |
| [node-postgres](https://node-postgres.com) | `pg` | 8.20.0 | the advisory lock of the ingestion, scripts | `services/ingest-service.js`, `scripts/*` | [Feeds](ingestion/feeds/README.md) |

## Client

| Tool | Package | Version | What for | Where in the code | Documented in |
|---|---|---|---|---|---|
| [React](https://react.dev) | `react` | 19.2.4 | every page | `client/src/` | [client docs](../../client/docs/README.md) |
| [React Router](https://reactrouter.com) | `react-router-dom` | 7.14.0 | the pages `/briefing`, `/search`, `/profile`, `/following`... | `client/src/App.jsx`, `pages/*` | [client docs](../../client/docs/README.md) |
| [Vite](https://vite.dev) | `vite` | 7.3.1 | build and dev server, `/api` sent to the API | `client/vite.config.js` | |
| [Tailwind CSS](https://tailwindcss.com) | `tailwindcss` | 4.2.2 | the styles and the tokens of the editorial design | `client/src/styles/index.css`, `@tailwindcss/vite` | |
| [Radix UI](https://www.radix-ui.com) | `radix-ui` | 1.4.3 | the accessible parts of the page: Dialog, DropdownMenu, ScrollArea, Slider (the days of a briefing), Tabs, ToggleGroup, Tooltip | `client/src/components/ui/*`, `BriefingFormat.jsx`, `BriefingSize.jsx`, `BriefingWindow.jsx`, `WatchedNews.jsx`... | |
| [shadcn](https://ui.shadcn.com) | `shadcn` | 4.2.0 | the CLI the components of `components/ui` came from | `client/components.json` | |
| [Lucide](https://lucide.dev) | `lucide-react` | 1.8.0 | icons | `MailBar.jsx`, `MailPicture.jsx`, `ProfileSwitcher.jsx`, `LanguageMark.jsx`, `field.jsx` | |
| [react-icons](https://react-icons.github.io/react-icons/) | `react-icons` | 5.6.0 | the icons of the thumbs and of the sources | `BriefingCard.jsx`, `SourceList.jsx` | |
| [fflate](https://github.com/101arrowz/fflate) | `fflate` | 0.8.3 | reads an Excel file of sites in the browser, the file never sent | `client/src/features/briefing/importFile.js` | [Added by hand](sources/added-by-hand/README.md) |
| Fraunces, Source Serif 4 | `@fontsource-variable/fraunces` | 5.3.0 | the fonts of the editorial design | `client/src/styles/index.css` | |

## Tests and quality

| Tool | Package | Version | Where |
|---|---|---|---|
| [Jest](https://jestjs.io) | `jest` | 30.3.0 | `server/tests/` (`pnpm test`) |
| [Vitest](https://vitest.dev) | `vitest` | 4.0.18 | `client/tests/` |
| [Testing Library](https://testing-library.com) | `@testing-library/react` | 16.3.2 | `client/tests/` |
| [jsdom](https://github.com/jsdom/jsdom) | `jsdom` | 28.1.0 | the browser of the client tests |
| [ESLint](https://eslint.org) | `eslint` | 10.2.1 | `server/eslint.config.js` (9.39.2 in the client) |

## Hosting

| Tool | Version | What for | Where | Documented in |
|---|---|---|---|---|
| [Docker Compose](https://docs.docker.com/compose/) | — | the containers of the server | `deploy/compose.yml`, `deploy/deploy.sh` | [31-deployment](a-to-z/31-deployment.png) |
| [Caddy](https://caddyserver.com) | 2.11 (`caddy:2.11-alpine`) | the client built and `/api` on one address | `deploy/Caddyfile` | [31-deployment](a-to-z/31-deployment.png) |
| [cloudflared](https://github.com/cloudflare/cloudflared) | 2026.9.3 | the tunnel of Cloudflare to `news.fabianrostello.com` | `deploy/compose.yml` | [31-deployment](a-to-z/31-deployment.png) |

## Documentation

| Tool | Version | What for | Where |
|---|---|---|---|
| [MkDocs](https://www.mkdocs.org) + [Material](https://squidfunk.github.io/mkdocs-material/) | 1.6.1 + 9.7.7 | this site: navigation, search, links checked at each build | `mkdocs.yml`, `docs-site/` |
| [PlantUML](https://plantuml.com) + [Graphviz](https://graphviz.org) | 1.2024.3 + 2.44.1 | the class, sequence, use case and deployment diagrams (`.puml`, rendered to `.png` next to them) | every folder of `docs/` |
| [Swagger UI](https://swagger.io/tools/swagger-ui/) | see **Server** | every route of the API | `config/swagger.js` |
