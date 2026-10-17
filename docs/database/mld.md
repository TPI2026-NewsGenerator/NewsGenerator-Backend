# MLD

What to reproduce in the diagram tool. Taken from `prisma/schema.prisma`, the scripts of `db/`, which
are what a fresh install creates, and checked against the database in service (its `information_schema`)
on 16.10.2026. Drawn as a diagram in `30-database.puml` (and `.png`), next to this file.

Some tables are not in `prisma/schema.prisma`: `entities`, `entity_links`, `profile_entities`,
`mentions`, `article_mentions`, `party_names` and `sent_mails` are read and written in SQL only
(`$queryRawUnsafe`), by `models/entity-model.js`, `mention-model.js`, `official-model.js` and
`sent-mail-model.js`.

## What changed since the sprint 3 diagram

**Nineteen tables to add**:

| Table | Why it exists |
|---|---|
| `feeds` | one row per feed address, with what the last fetch answered (`etag`, `last_modified`, `last_error`) so an unchanged feed is not read again |
| `articles` | the news of those feeds. This is what a search reads: no page is scraped to search. Each news also gets its bge-m3 vectors, its story and its names |
| `user_feeds` | the sources of a profile: added by hand, which are **private** (only that reader reads them), or found for the profile |
| `stories` | the news of several media telling the same fact, grouped in background as they come |
| `threads` | the stories of one affair followed over days: the preview of a match, its result, the reactions |
| `user_profiles` | what a reader wants to read, in their own words, and the languages they read. A reader has one or several |
| `profile_interests` | a profile or a project split by the AI into interests, one vector each |
| `profile_projects` | something the reader prepares for a time (a trip, a purchase, a report): its interests are read by the briefing until its last day |
| `briefings` | the stories chosen for a profile at one moment, as shown, with the thumbs, the news of what the profile follows and the AI analysis |
| `directory_feeds` | the feeds the server found itself: the main feed of the media Google News names, the sections of the media already read. Every search of their language reads them |
| `directory_tries` | the media looked at for the directory, found or not, so none is looked at again before 30 days |
| `directory_removed` | the feeds the directory took out because they serve no reader, with their counts, so they are not added again |
| `entities` | an item of Wikidata a profile follows or meets (a club, a person, a body): its names, its kind, its own channels |
| `entity_links` | what an item says of another: the players of a club, its coach, its league |
| `profile_entities` | the items a profile follows, the names its reader added or took out, and whether their news go to the briefing |
| `mentions` | a name as the news write it (person, organization, location), found by the tagger, and the item of Wikidata it is when only one is called so |
| `article_mentions` | the names of each news |
| `party_names` | the item of Wikidata a party of a card is, as the AI named it ("CONI"), searched once |
| `sent_mails` | the copies of the e-mails of a briefing sent before 13.10.2026, read by their link |

**Two tables to remove** — `filters` and `users_has_last_filters`. They belonged to the "last filter
applied" feature, which no longer exists. No code references them, no script in `db/` creates them,
and they are not in `prisma/schema.prisma`. They are still present (empty) in the database in service
as leftovers of an older `create_insert_NewsGenerator.sql` — but a fresh install has neither.

## The twenty-four tables

Types are the PostgreSQL ones. `id` is always `integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY` (`BY
DEFAULT` for `user_profiles` and `profile_projects`), and `timestamptz` is `timestamp with time zone`.
The vector types come from the `vector` extension (pgvector): `vector(1024)` and `halfvec(1024)` are the
dense vectors of bge-m3 (the second in half precision), `sparsevec(250002)` the weight of each word of
its vocabulary.

Sizes in service on 16.10.2026, to give an idea: 2 000 000 `articles` (the last 8 days), 920 000
`stories`, 710 000 `threads`, 1 200 000 `mentions` and 6 500 000 `article_mentions`, 4 300 `feeds`,
2 300 `directory_feeds`; 10 users, 10 profiles, 24 interests, about 100 briefings.

### Accounts

#### roles
| Column | Type | |
|---|---|---|
| id | integer | PK |
| role | text | NOT NULL, UNIQUE — `Admin` or a member's (`services/utils/admin.js`) |

#### users
| Column | Type | |
|---|---|---|
| id | integer | PK |
| username | text | NOT NULL |
| email | text | NOT NULL |
| password | text | NOT NULL, bcrypt hash |
| role | integer | NOT NULL, FK → roles.id |
| password_changed_at | timestamptz | null — the last change of password: the sessions opened before are refused (`db/add_password_changed.sql`) |

UNIQUE (username, email), and since the signup (`db/add_signup.sql`) two unique indexes whatever the
case: `u_users_username_ci` on `lower(username)`, `u_users_email_ci` on `lower(email)`. The role is read
in the database at each request, never in the session: a reader made an administrator has it at once.

### Saved searches

#### categories
| Column | Type | |
|---|---|---|
| id | integer | PK |
| category_name | text | NOT NULL, UNIQUE |

Kept in step with the categories of `db/rss-links.js`: world, press, sport, politics, economy,
technology, science.

#### custom_searches
| Column | Type | |
|---|---|---|
| id | integer | PK |
| id_user | integer | NOT NULL, FK → users.id |
| title | text | NOT NULL |
| language | text | NOT NULL |
| timeframe | text | NOT NULL |
| keyword | text | NOT NULL |

UNIQUE (id_user, title)

#### custom_searches_has_categories
| Column | Type | |
|---|---|---|
| id | integer | PK |
| id_custom_search | integer | NOT NULL, FK → custom_searches.id |
| id_category | integer | NOT NULL, FK → categories.id |

UNIQUE (id_custom_search, id_category)

### The shared cache: feeds, news, stories, threads

#### feeds
| Column | Type | |
|---|---|---|
| id | integer | PK |
| url | text | NOT NULL, UNIQUE |
| etag | text | null |
| last_modified | text | null |
| last_fetched_at | timestamptz | null — null means never read |
| last_error | text | null — why the last refresh failed, shown to the reader for their own sources |
| failures | integer | NOT NULL, default 0 — refreshes failed in a row (`db/add_feed_failures.sql`) |
| last_success_at | timestamptz | NOT NULL, default now() — last refresh that worked; failing for 3 days, the feed is read once a day |

#### articles
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
| search_text | text | **generated by Postgres**: `article_search_text(title, description, category)`, never written by the app |
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
| entities_at | timestamptz | null — when the tagger read its names, null before (`db/add_named_entities.sql`) |

UNIQUE (id_feed, link) — the same news in two feeds is two rows, and the search keeps one per link.

Indexes:
- `i_articles_created_at` on `created_at`, for the purge of the old articles
- `i_articles_search_text` **GIN** on `search_text` with `gin_trgm_ops`, which is what makes the
  keyword search and the grouping of duplicates possible
- `i_articles_story` on `id_story`
- `i_articles_not_embedded` on `created_at` WHERE `embedded_at IS NULL`, the news waiting for vectors
- `i_articles_untagged` on `created_at DESC` WHERE `entities_at IS NULL`, the news waiting for the tagger
  (`db/add_untagged_index.sql`)
- `i_articles_published` on `COALESCE(published_at, created_at)`
- `i_articles_grouped` on `(lang, COALESCE(published_at, created_at))` WHERE `id_story IS NOT NULL`
- `i_articles_link` and `i_articles_title`, **hash**, WHERE `id_story IS NOT NULL`: same link or same
  title in its medium always joins the story
- `i_articles_feed_published` on `(id_feed, published_at)`: a news a feed gives again under another link
  is found before it is saved (`db/add_article_repeats.sql`)
- `i_articles_medium` on `(medium, created_at)`: the news of one medium of the last days, for the
  official source of a card (`db/add_articles_medium_index.sql`)

The vectors have no index on purpose (no HNSW): they are always compared among a few thousand news of
the last days, which a filter on the date gives first.

`search_text` needs the `pg_trgm` extension (`db/add_articles_search.sql`). `medium_of` and `figures_of`
are in `db/add_briefing.sql`. Three extensions are needed in all: `pg_trgm` for the keyword search and
the grouping, `unaccent` (`db/add_unaccent.sql`) so that two papers spelling a name differently still
group, and `vector` (`db/add_briefing.sql`) for the vectors.

#### stories
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
`i_stories_to_thread` on `grouped_at` WHERE `grouped_at IS NOT NULL`, `i_stories_waiting` on
`(updated_at, id)` WHERE `grouped_at > COALESCE(threaded_at, '-infinity')` (the stories to thread),
`i_stories_lang` and `i_stories_no_centroid` on `lang`, with and without a centroid.

Filled by the SQL function `assign_stories` (`db/add_briefing.sql`), after each batch of vectors.
`centroid` is stored in the row (`STORAGE PLAIN`), not apart: it is read at every run.

#### threads
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
(`db/add_threads.sql`), after each grouping; `thread_shortlists` gives it the candidates.

### The names of the news

#### mentions
| Column | Type | |
|---|---|---|
| id | integer | PK |
| key | text | NOT NULL — the name as it is compared: small letters, no accents, no leading article (`services/utils/mentions.js`) |
| kind | text | NOT NULL — `person`, `organization` or `location` |
| name | text | NOT NULL — as the first news wrote it |
| lang | text | null — of the first news naming it, the language Wikidata is searched in |
| qid | text | null — the item of Wikidata it is, null when none or several are called so ("Paris") |
| linked_at | timestamptz | null — when it was looked for in Wikidata |
| seen | integer | NOT NULL, default 0 — the news naming it: the most named are looked for first |
| wanted_at | timestamptz | null — a reader saw it (on a card, the page of a name): looked for before the others (`db/add_mentions_wanted.sql`) |
| created_at | timestamptz | NOT NULL, default `now()` |

UNIQUE (key, kind). Indexes `i_mentions_qid` on `qid` WHERE not null, `i_mentions_to_link` on
`seen DESC` WHERE `linked_at IS NULL`, `i_mentions_wanted` on `wanted_at` WHERE not linked and wanted.

#### article_mentions
| Column | Type | |
|---|---|---|
| id_mention | integer | PK (with id_article), FK → mentions.id, ON DELETE CASCADE |
| id_article | integer | PK, FK → articles.id, ON DELETE CASCADE — gone with the news |

Index `i_article_mentions_article` on `id_article`. Filled by `services/tagging-service.js` with what the
tagger (`ner/server.py`, GLiNER) reads in the title and the start of each news.

### Readers, profiles and what they follow

#### user_profiles
| Column | Type | |
|---|---|---|
| id | integer | PK (`GENERATED BY DEFAULT`, since `db/add_profiles.sql`) |
| id_user | integer | NOT NULL, FK → users.id, ON DELETE CASCADE |
| name | text | NOT NULL, default `'Profil'` — "Travail", "Loisirs" |
| text | text | NOT NULL — the profile in the words of the reader |
| languages | text[] | NOT NULL, default `{}` — the languages they read |
| watch_terms | text[] | NOT NULL, default `{}` — the names or words it follows as written: a news naming one is shown in a section of the briefing of its own |
| refused | text[] | NOT NULL, default `{}` — what the reader says they do not want, as the AI read it in the text |
| kept_sources | text[] | NOT NULL, default `{}` — feeds kept by the reader after their thumbs left them out |
| removed_sources | jsonb | NOT NULL, default `[]` — the feeds found for the profile the reader removed, `[{url, site, category, language}]`: never found again, given back as they were |
| discovery_status | text | NOT NULL, default `'idle'` — the search of sources for the profile: idle, running, done, failed |
| discovery_error | text | null |
| discovered_at | timestamptz | null |
| created_at | timestamptz | NOT NULL, default `now()` |
| updated_at | timestamptz | NOT NULL, default `now()` |

Index `i_user_profiles_user` on `id_user`. A reader has one profile, several for an administrator; each
one is independent: its interests, its sources, its briefings and thumbs, what it follows.

#### profile_projects
| Column | Type | |
|---|---|---|
| id | integer | PK |
| id_profile | integer | NOT NULL, FK → user_profiles.id, ON DELETE CASCADE |
| name | text | NOT NULL |
| text | text | NOT NULL — written with the AI as a profile is |
| ends_on | date | null — the last day it is read; none: until the reader deletes it |
| created_at | timestamptz | NOT NULL, default `now()` |

Index `i_profile_projects_profile` on `id_profile` (`db/add_projects.sql`). No source is found for a
project: its interests are ranked on the sources of the profile, and the Google News searches of its
interests are read while it runs. An ended project is kept, and read no more, until it is deleted.

#### profile_interests
| Column | Type | |
|---|---|---|
| id | integer | PK |
| id_user | integer | NOT NULL, FK → users.id, ON DELETE CASCADE |
| id_profile | integer | NOT NULL, FK → user_profiles.id, ON DELETE CASCADE |
| id_project | integer | null, FK → profile_projects.id, ON DELETE CASCADE — an interest of a project goes with it |
| position | integer | NOT NULL — its order in the profile |
| text | text | NOT NULL — "Rugby: Top 14, Six Nations, transfers" |
| weight | real | NOT NULL, default 1 |
| keywords | text | NOT NULL, default `''` — to find media and their section |
| searches | text[] | NOT NULL, default `{}` — short searches for Google News, read by the ingestion and by the search of every reader of that language (never who follows them) |
| sections | text[] | NOT NULL, default `{}` — names of the section of a newspaper |
| category | text | null — one of `db/rss-links.js`, given to the feeds found for it |
| dense | vector(1024) | null |
| sparse | sparsevec(250002) | null |

Indexes on `id_user`, `id_profile`, and `id_project` WHERE not null. Saving a profile replaces all its
interests.

#### user_feeds
| Column | Type | |
|---|---|---|
| id | integer | PK |
| id_user | integer | NOT NULL, FK → users.id, ON DELETE CASCADE |
| id_profile | integer | null, FK → user_profiles.id, ON DELETE CASCADE — null only for a reader who never wrote a profile |
| url | text | NOT NULL — the feed, not the site |
| site | text | NOT NULL — what the reader typed, to show it back to them |
| category | text | NOT NULL |
| created_at | timestamptz | NOT NULL, default `now()` |
| origin | text | NOT NULL, default `'user'` — `user` when added by hand, `profile` when found for the profile |
| language | text | null |
| trusted | boolean | NOT NULL, default false — a source the reader trusts (`db/add_trusted_sources.sql`) |
| shared | boolean | NOT NULL, default false — no longer read nor written since 16.10.2026: every source is read for everyone since 8.10.2026 (`db/add_source_growth.sql`, the column kept) |

UNIQUE (id_profile, url) `u_user_feeds_profile`, indexes on `id_user`, `id_profile` and `url`.

The same feed added by two profiles is two rows, one per profile. A search reads the rows of its
profile, and those of every reader, found for a profile or added by hand, except the addresses that hold
a key (`FeedModel.publicFeedUrls`, `looksPrivate`); a briefing too (`FeedModel.everyoneFeedUrls`).

#### entities
| Column | Type | |
|---|---|---|
| id | integer | PK |
| qid | text | NOT NULL, UNIQUE — "Q12345" |
| label | text | NOT NULL |
| description | text | null |
| kind | text | NOT NULL, default `'other'` — person, club, team, competition, organisation, other |
| names | text[] | NOT NULL, default `{}` — the ones its news are found by: its label in the languages read, its aliases kept |
| fetched_at | timestamptz | null — read in full from Wikidata; null for an item met only as a link |
| channels | jsonb | null — its own channels as Wikidata gives them: `{"site": [...], "x": [...], "bluesky": [...]}`, for the official source of a card (`db/add_official_sources.sql`) |
| channels_at | timestamptz | null — read again after 30 days |
| site_feed | text | null — the feed of its website, found once; `''` when it has none |
| site_feed_at | timestamptz | null — tried again after 7 days |

One row per item, shared by every reader.

#### entity_links
| Column | Type | |
|---|---|---|
| id_from | integer | PK (with id_to, relation), FK → entities.id, ON DELETE CASCADE |
| id_to | integer | PK, FK → entities.id, ON DELETE CASCADE |
| relation | text | PK — `player` (of a club), `coach`, `league`, `team` (of a person)... |

Index `i_entity_links_to` on `id_to`.

#### profile_entities
| Column | Type | |
|---|---|---|
| id_profile | integer | PK (with id_entity), FK → user_profiles.id, ON DELETE CASCADE |
| id_entity | integer | PK, FK → entities.id, ON DELETE CASCADE |
| added_names | text[] | NOT NULL, default `{}` — names its reader added ("PSG") |
| removed_names | text[] | NOT NULL, default `{}` — names its reader took out ("Paris") |
| in_briefing | boolean | NOT NULL, default true — its news are in the briefing unless the reader unticks it (`db/add_follow_in_briefing.sql`) |
| created_at | timestamptz | NOT NULL, default `now()` |

#### party_names
| Column | Type | |
|---|---|---|
| name | text | PK (with what) — a party of a card as the AI named it: "CONI" |
| what | text | PK, default `''` — what the AI said it is |
| qid | text | null — the item found; null: none, searched again after 7 days |
| checked_at | timestamptz | NOT NULL, default `now()` |

Points to `entities` by its `qid`, not by a key: the item may not be read yet.

### Briefings and e-mails

#### briefings
| Column | Type | |
|---|---|---|
| id | integer | PK |
| id_user | integer | NOT NULL, FK → users.id, ON DELETE CASCADE |
| id_profile | integer | NOT NULL, FK → user_profiles.id, ON DELETE CASCADE |
| status | text | NOT NULL, default `'running'` — running, ready, failed |
| step | text | null — what it is doing, shown while it runs |
| error | text | null |
| hours | integer | NOT NULL, default `48` — the news it was written from: 1 to 7 days, chosen by the reader (`db/add_briefing_window.sql`) |
| size | integer | NOT NULL, default `10` — the cards asked for (`db/add_profiles.sql`) |
| items | jsonb | NOT NULL, default `[]` — the cards as shown, with the thumb of the reader on each (`vote`, `votedAt`) and when it was sent by e-mail (`sentAt`); a news added by its link is a card with a negative `storyId` |
| watched | jsonb | null — the news of what the profile follows: `[{term, qid, news: [...]}]` |
| analysis | jsonb | null — the AI analysis of its cards: `{status, startedAt, model, ...}` (`db/add_briefing_analysis.sql`) |
| created_at | timestamptz | NOT NULL, default `now()` |
| finished_at | timestamptz | null |

Indexes `i_briefings_user` on `(id_user, created_at DESC)` and `i_briefings_profile` on `(id_profile,
created_at DESC)`. The thumbs have no table of their own: they are read from `items` of the briefings of
the last 30 days.

#### sent_mails
| Column | Type | |
|---|---|---|
| id | integer | PK |
| token | text | NOT NULL, UNIQUE — the secret part of the address of the copy (`/api/mails/<token>`) |
| id_user | integer | NOT NULL, FK → users.id, ON DELETE CASCADE |
| id_briefing | integer | null, FK → briefings.id, ON DELETE SET NULL |
| subject | text | NOT NULL |
| html | text | NOT NULL — the e-mail as sent, its pictures written in it |
| created_at | timestamptz | NOT NULL, default `now()` |

No copy is kept since 13.10.2026: the table only answers the links of the e-mails sent before.

### The directory of media

#### directory_feeds
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

#### directory_tries
| Column | Type | |
|---|---|---|
| medium | text | PK (with origin) |
| origin | text | PK, CHECK in (`named`, `section`) |
| tried_at | timestamptz | NOT NULL, default `now()` |
| kept | integer | NOT NULL, default 0 — the feeds kept |
| reason | text | null — why none was |

A medium is looked at again only 30 days after `tried_at`.

#### directory_removed
| Column | Type | |
|---|---|---|
| url | text | PK |
| medium | text | NOT NULL |
| origin | text | NOT NULL, CHECK in (`named`, `section`) |
| language | text | null |
| category | text | null |
| news | integer | NOT NULL, default 0 — its news over the days measured |
| relevant | integer | NOT NULL, default 0 — the ones close to a reader's interest |
| reason | text | NOT NULL |
| removed_at | timestamptz | NOT NULL, default `now()` |

None of the three points to another table: a medium is a name, and a feed of the directory is read like
any other, by its address.

## Relations

```
roles          1 ──< N  users
users          1 ──< N  custom_searches   1 ──< N  custom_searches_has_categories  N >── 1  categories
users          1 ──< N  user_profiles
users          1 ──< N  user_feeds, profile_interests, briefings, sent_mails   (the owner, for the cascade)
user_profiles  1 ──< N  user_feeds
user_profiles  1 ──< N  profile_interests
user_profiles  1 ──< N  profile_projects  1 ──< N  profile_interests   (0 or 1 project per interest)
user_profiles  1 ──< N  briefings         1 ──< N  sent_mails          (0 or 1 briefing per mail)
user_profiles  1 ──< N  profile_entities  N >── 1  entities
entities       1 ──< N  entity_links      N >── 1  entities             (from, to)
feeds          1 ──< N  articles
stories        1 ──< N  articles          (0 or 1 story per article)
threads        1 ──< N  stories           (0 or 1 thread per story)
articles       1 ──< N  article_mentions  N >── 1  mentions
mentions       N ··· 1  entities          by qid, no foreign key
party_names    N ··· 1  entities          by qid, no foreign key
user_feeds     N ··· 1  feeds             by url, no foreign key
```

`feeds`, `articles`, `stories`, `threads`, `mentions`, `entities` and the directory are attached to no
user: the cache is shared, and who may read which feed is decided by the search: the feeds of
`db/rss-links.js`, the `user_feeds` of every reader (but the addresses that hold a key), the Google News searches of every `profile_interests`, and the `directory_feeds`; and, when these
answer little, Google News asked the sentence itself. The profile of the reader does not narrow a search:
it only chooses the briefing. `user_feeds` points to a feed by its `url`, not by a key to `feeds`: a source
is added before its feed is first read.

## SQL functions

| Function | Script | What |
|---|---|---|
| `article_search_text` | `add_articles_search.sql` | the text the keyword search reads, generated in `articles.search_text` |
| `medium_of`, `figures_of`, `title_names` | `add_briefing.sql` | the medium of a link, the figures and the names of a title |
| `matchup_team`, `matchup_of`, `different_matches` | `add_briefing.sql` | two news of two different matches never join one story |
| `assign_stories` | `add_briefing.sql` | each news with vectors joins a story or starts one |
| `rank_stories` | `add_briefing.sql` | the stories closest to every interest of a user (kept for the server of before the profiles) |
| `rank_profile_stories` | `add_projects.sql` | the stories closest to the interests of one profile and of its running projects |
| `thread_shortlists`, `assign_threads` | `add_threads.sql` | the stories of one affair linked in a thread |
