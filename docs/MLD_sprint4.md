# MLD — sprint 4

What to reproduce in the diagram tool. Taken from `prisma/schema.prisma` and the scripts of `db/`,
which are what a fresh install creates. Brought up to date on 30.09.2026, again after the search read
the sources of the other readers (who reads which rows, see `user_feeds`, `profile_interests` and the
relations), and once more for the directory of the project: two tables, `directory_feeds` and
`directory_tries` (`db/add_directory.sql`).

## What changed since the sprint 3 diagram

**Ten tables to add**:

| Table | Why it exists |
|---|---|
| `feeds` | one row per feed address, with what the last fetch answered (`etag`, `last_modified`, `last_error`) so an unchanged feed is not read again |
| `articles` | the news of those feeds. This is what a search reads: no page is scraped to search. Each news also gets its bge-m3 vectors and its story |
| `user_feeds` | the sources of a user: added by hand, which are **private** (only that user reads them), or found for their profile |
| `stories` | the news of several media telling the same fact, grouped in background as they come |
| `threads` | the stories of one affair followed over days: the preview of a match, its result, the reactions |
| `user_profiles` | what a user wants to read, in their own words, and the languages they read |
| `profile_interests` | that profile split by the AI into interests, one vector each |
| `briefings` | the stories chosen for a user at one moment, as shown to them, with their thumbs |
| `directory_feeds` | the feeds the server found itself: the main feed of the media Google News names, the sections of the media already read. Every search of their language reads them |
| `directory_tries` | the media looked at for the directory, found or not, so none is looked at again before 30 days |

**Two tables to remove** — `filters` and `users_has_last_filters`. They belonged to the "last filter
applied" feature, which no longer exists. No code references them, no script in `db/` creates them,
and they are not in `prisma/schema.prisma`. They are still present in the development database as
leftovers of an older `create_insert_NewsGenerator.sql`, so `SELECT` still finds them there — but a
fresh install has neither.

## The fifteen tables

Types are the PostgreSQL ones. `id` is always `integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY`,
and `timestamptz` is `timestamp with time zone`. The vector types come from the `vector` extension
(pgvector): `vector(1024)` and `halfvec(1024)` are the dense vectors of bge-m3 (the second in half
precision), `sparsevec(250002)` the weight of each word of its vocabulary.

### roles
| Column | Type | |
|---|---|---|
| id | integer | PK |
| role | text | NOT NULL, UNIQUE |

### users
| Column | Type | |
|---|---|---|
| id | integer | PK |
| username | text | NOT NULL |
| email | text | NOT NULL |
| password | text | NOT NULL, bcrypt hash |
| role | integer | NOT NULL, FK → roles.id |

UNIQUE (username, email), and since the signup (`db/add_signup.sql`) two unique indexes whatever the
case: `u_users_username_ci` on `lower(username)`, `u_users_email_ci` on `lower(email)`.

### categories
| Column | Type | |
|---|---|---|
| id | integer | PK |
| category_name | text | NOT NULL, UNIQUE |

Kept in step with the categories of `db/rss-links.js`: world, press, sport, politics, economy,
technology, science.

### custom_searches
| Column | Type | |
|---|---|---|
| id | integer | PK |
| id_user | integer | NOT NULL, FK → users.id |
| title | text | NOT NULL |
| language | text | NOT NULL |
| timeframe | text | NOT NULL |
| keyword | text | NOT NULL |

UNIQUE (id_user, title)

### custom_searches_has_categories
| Column | Type | |
|---|---|---|
| id | integer | PK |
| id_custom_search | integer | NOT NULL, FK → custom_searches.id |
| id_category | integer | NOT NULL, FK → categories.id |

UNIQUE (id_custom_search, id_category)

### feeds — *new*
| Column | Type | |
|---|---|---|
| id | integer | PK |
| url | text | NOT NULL, UNIQUE |
| etag | text | null |
| last_modified | text | null |
| last_fetched_at | timestamptz | null — null means never read |
| last_error | text | null — why the last refresh failed, shown to the user for their own sources |
| failures | integer | NOT NULL, default 0 — refreshes failed in a row (`db/add_feed_failures.sql`) |

### articles — *new*
| Column | Type | |
|---|---|---|
| id | integer | PK |
| id_feed | integer | NOT NULL, FK → feeds.id, ON DELETE CASCADE |
| link | text | NOT NULL |
| title | text | NOT NULL |
| description | text | NOT NULL, default `''` |
| thumbnail | text | null |
| category | text[] | NOT NULL, default `{}` — the categories the feed itself gives |
| published_at | timestamptz | null — the date of the feed, absent on some |
| created_at | timestamptz | NOT NULL, default `now()` — when we first saw it, used when `published_at` is null |
| topic | text | null — given by the AI with the key passages |
| summary | text | null — the key passages as one text, saved so the same news is never read by the AI twice |
| sourcing | text | null — `named`, `anonymous` or `none`, given by the AI with the key passages |
| extract | jsonb | null — the key passages, word for word (`db/add_extracts.sql`) |
| translation | jsonb | null — their machine translation |
| translation_language | text | null — the language of that translation |
| search_text | text | **generated by Postgres**, never written by the app |
| source_url | text | null — the publisher Google News names, for a news read through it (`db/add_google_news.sql`) |
| resolved_link | text | null — the real address of such a news, once asked |
| medium | text | **generated by Postgres**: `medium_of(COALESCE(source_url, link))` |
| title_figures | text[] | **generated by Postgres**: `figures_of(title)`, the figures of the title |
| lang | text | null — its language, read with the vectors |
| title_dense | halfvec(1024) | null — the meaning of the title, kept in the row |
| title_sparse | sparsevec(250002) | null — the words of the title |
| text_dense | halfvec(1024) | null — the meaning of the title and the start of the description, kept in the row |
| text_sparse | sparsevec(250002) | null |
| embedded_at | timestamptz | null — null means no vectors yet |
| id_story | integer | null, FK → stories.id, ON DELETE SET NULL |

UNIQUE (id_feed, link) — the same news in two feeds is two rows, and the search keeps one per link.

Indexes:
- `i_articles_created_at` on `created_at`, for the purge of the old articles
- `i_articles_search_text` **GIN** on `search_text` with `gin_trgm_ops`, which is what makes the
  keyword search and the grouping of duplicates possible
- `i_articles_story` on `id_story`
- `i_articles_not_embedded` on `created_at` WHERE `embedded_at IS NULL`, the news waiting for vectors
- `i_articles_published` on `COALESCE(published_at, created_at)`
- `i_articles_grouped` on `(lang, COALESCE(published_at, created_at))` WHERE `id_story IS NOT NULL`

The vectors have no index on purpose (no HNSW): they are always compared among a few thousand news of
the last days, which a filter on the date gives first.

`search_text` is filled by the function `article_search_text(title, description, category)` of
`db/add_articles_search.sql`. It needs the `pg_trgm` extension, which the same script creates.
`medium_of` and `figures_of` are in `db/add_briefing.sql`.

Three extensions are needed in all: `pg_trgm` for the keyword search and the grouping, `unaccent`
(`db/add_unaccent.sql`) so that two papers spelling a name differently still group, and `vector`
(`db/add_briefing.sql`) for the vectors.

### user_feeds — *new*
| Column | Type | |
|---|---|---|
| id | integer | PK |
| id_user | integer | NOT NULL, FK → users.id, ON DELETE CASCADE |
| url | text | NOT NULL — the feed, not the site |
| site | text | NOT NULL — what the user typed, to show it back to them |
| category | text | NOT NULL |
| created_at | timestamptz | NOT NULL, default `now()` |
| origin | text | NOT NULL, default `'user'` — `user` when added by hand, `profile` when found for the profile |
| language | text | null |
| trusted | boolean | NOT NULL, default false — a source the reader trusts (`db/add_trusted_sources.sql`) |
| shared | boolean | NOT NULL, default false — a source the reader shares: it can be suggested to the others, and their searches read it (`db/add_source_growth.sql`) |

UNIQUE (id_user, url), indexes on `id_user` and on `url`.

The same feed added by two users is two rows: that is what makes a source private, and the refresh
groups the feeds by user for the same reason. A search reads the rows of its reader, and those of every
reader with `origin = 'profile'` or `shared = true`, of the language of the search: a row added by hand
and not shared stays its reader's (`FeedModel.publicFeedUrls`).

### stories — *new*
| Column | Type | |
|---|---|---|
| id | integer | PK |
| lang | text | NOT NULL — stories are grouped per language |
| created_at | timestamptz | NOT NULL, default `now()` |
| updated_at | timestamptz | NOT NULL, default `now()` |
| grouped_at | timestamptz | null — when a news last joined it |
| id_thread | integer | null, FK → threads.id, ON DELETE SET NULL |
| centroid | halfvec(1024) | null — the mean of the `text_dense` of its news, normalized |
| media | text[] | NOT NULL, default `{}` — the media that wrote it |
| threaded_at | timestamptz | null — when its thread was last judged |

Indexes: `i_stories_updated_at` on `updated_at`, `i_stories_thread` on `id_thread`,
`i_stories_to_thread` on `grouped_at` WHERE `grouped_at IS NOT NULL`.

Filled by the SQL function `assign_stories` (`db/add_briefing.sql`), after each batch of vectors.
`centroid` is stored in the row (`STORAGE PLAIN`), not apart: it is read at every run.

### threads — *new*
| Column | Type | |
|---|---|---|
| id | integer | PK |
| lang | text | NOT NULL — a thread is of one language, as its stories |
| created_at | timestamptz | NOT NULL, default `now()` |
| updated_at | timestamptz | NOT NULL, default `now()` — its newest news |
| centroid | halfvec(1024) | null — the mean of the centroids of its stories |
| media | text[] | NOT NULL, default `{}` |
| n_stories | integer | NOT NULL, default 0 |

Index `i_threads_lang_updated` on `(lang, updated_at)`. Filled by the SQL function `assign_threads`
(`db/add_threads.sql`), after each grouping.

### user_profiles — *new*
| Column | Type | |
|---|---|---|
| id_user | integer | PK, FK → users.id, ON DELETE CASCADE |
| text | text | NOT NULL — the profile in the words of the user |
| topics | text[] | NOT NULL, default `{}` — the themes ticked at the start |
| languages | text[] | NOT NULL, default `{}` — the languages they read |
| discovery_status | text | NOT NULL, default `'idle'` — the search of sources for the profile: idle, running, done, failed |
| discovery_error | text | null |
| discovered_at | timestamptz | null |
| updated_at | timestamptz | NOT NULL, default `now()` |
| kept_sources | text[] | NOT NULL, default `{}` — feeds kept by the reader after their thumbs left them out |

One profile per user: its key is the user.

### profile_interests — *new*
| Column | Type | |
|---|---|---|
| id | integer | PK |
| id_user | integer | NOT NULL, FK → users.id, ON DELETE CASCADE |
| position | integer | NOT NULL — its order in the profile |
| text | text | NOT NULL — "Rugby: Top 14, Six Nations, transfers" |
| weight | real | NOT NULL, default 1 |
| keywords | text | NOT NULL, default `''` — to find media and their section |
| searches | text[] | NOT NULL, default `{}` — short searches for Google News, read by the ingestion and by the search of every reader of that language (never who follows them) |
| sections | text[] | NOT NULL, default `{}` — names of the section of a newspaper |
| category | text | null — one of `db/rss-links.js`, given to the feeds found for it |
| dense | vector(1024) | null |
| sparse | sparsevec(250002) | null |

Index `i_profile_interests_user` on `id_user`. The interests hang on the user, not on
`user_profiles`: saving a profile replaces them all.

### briefings — *new*
| Column | Type | |
|---|---|---|
| id | integer | PK |
| id_user | integer | NOT NULL, FK → users.id, ON DELETE CASCADE |
| status | text | NOT NULL, default `'running'` — running, ready, failed |
| step | text | null — what it is doing, shown while it runs |
| error | text | null |
| items | jsonb | NOT NULL, default `[]` — the cards as shown, and the thumb of the reader on each (`vote`, `votedAt`) |
| created_at | timestamptz | NOT NULL, default `now()` |
| finished_at | timestamptz | null |

Index `i_briefings_user` on `(id_user, created_at DESC)`. The thumbs have no table of their own: they
are read from `items` of the briefings of the last 30 days.

### directory_feeds — *new*
| Column | Type | |
|---|---|---|
| url | text | PK — the feed |
| medium | text | NOT NULL — "nbcnews.com" |
| origin | text | NOT NULL, CHECK in (`named`, `section`) — `named`: the main feed of a medium Google News names and no feed of ours reads; `section`: a section of a medium already read that brings what its feeds miss |
| language | text | null — told by its own news |
| category | text | null — none for a medium on everything, read whatever the categories searched |
| created_at | timestamptz | NOT NULL, default `now()` |

Index on `language`. A search reads the rows of its language, of its categories or of none
(`DirectoryModel.feedUrls`); the background work reads them all.

### directory_tries — *new*
| Column | Type | |
|---|---|---|
| medium | text | PK (with origin) |
| origin | text | PK, CHECK in (`named`, `section`) |
| tried_at | timestamptz | NOT NULL, default `now()` |
| kept | integer | NOT NULL, default 0 — the feeds kept |
| reason | text | null — why none was |

A medium is looked at again only 30 days after `tried_at`. Neither table points to another: a medium is
a name, and a feed of the directory is read like any other, by its address.

## Relations

```
roles      1 ──< N  users
users      1 ──< N  custom_searches      1 ──< N  custom_searches_has_categories  N >── 1  categories
users      1 ──< N  user_feeds
users      1 ──  1  user_profiles        (0 or 1 profile per user)
users      1 ──< N  profile_interests
users      1 ──< N  briefings
feeds      1 ──< N  articles
stories    1 ──< N  articles             (0 or 1 story per article)
threads    1 ──< N  stories              (0 or 1 thread per story)
```

`feeds`, `articles`, `stories` and `threads` are attached to no user: the cache is shared, and who may
read which feed is decided by the search: the feeds of `db/rss-links.js` (387, 34 of them taken from
awesome-rss-feeds by `scripts/import-awesome-feeds.js`), the `user_feeds` of that user, the ones of the
other readers found for a profile or shared, the Google News searches of every `profile_interests`, and
the `directory_feeds`; and, when these answer little, Google News asked the sentence itself.
The profile of the reader does not narrow a search: it only chooses the briefing.
`user_feeds` points to a feed by its `url`, not by a key to `feeds`: a source is added before its feed
is first read.
