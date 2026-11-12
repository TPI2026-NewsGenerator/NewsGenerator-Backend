# API v1 > The news we select, judged again by another system

`/api/v1` is the read-only door of another system (the claims graph of FootballIQ). Our system makes the **first selection**, fast and cheap; the other
system, slower and more sure, **judges again** what we selected and sends its verdict back. Three routes give it the news:

| Route | What it lists | One item is |
|---|---|---|
| `GET /api/v1/news` | the news that name a person and/or an association (it asks for them) | a news |
| `GET /api/v1/fifa/news` | the news **selected for the map "The FIFA presidency"** | a passage: the sentence of a news about one association and one candidate |
| `GET /api/v1/briefing/news` | the news **selected in the briefings of all the readers** | a story (a card), its articles and what we found around it |

The first is described in `services/news-export-service.js`. This page is about the two others. None of them makes an AI call: they read what the
system already kept.

## What they have in common

- **Key.** `Authorization: Bearer <key>`, one key per client (`API_KEYS` in `api.env`, see [Deployment](../deployment.md)). 60 requests a minute a key.
- **Errors.** `{error: {code, message, parameter?}}`; a parameter that is not understood is a `422` that names it, and nothing is read.
- **Paging.** `limit` (50 by default), `order` (`asc` by default), `cursor` (the `next_cursor` of the previous answer, as it was given). The answer is
  `{items, next_cursor, has_more, order}`. `next_cursor` is **always** given when the page holds something, even on the last page: a client that follows
  the news keeps it and asks again with it the next day (and gets an empty page when nothing came, `has_more: false`). Order `asc` + `cursor` is the way
  to **follow**; `since` / `until` are for browsing.
- **Never given.** A link that carries a key (`?token=`, `?key=`...), a login in the address, one of our RSS-Bridge feeds. An item whose links are all
  of those is left out (the cursor goes on all the same). Nothing of a reader.
- **Log.** Each call writes one line (client, route, status, items, names of the parameters), see [Deployment](../deployment.md).

## `GET /api/v1/fifa/news` — the passages selected for the map

One item per **passage** of `fifa_signals` (`db/add_fifa_map.sql`): the sentence of a news that names an association and a candidate, read by two models
(see [the map](../briefing/fifa-map/README.md)). A news that names two associations comes twice, with two ids.

**What we select** (the default): `established` (a position that colours the map) and `uncertain` (about the election and the association but not a
position: a vice-president, a rumour, a request, a rival...). `discarded` (read and left out, mostly noise) is given only when asked
(`certainty=discarded`): to learn what we no longer select, or to measure what we left out. Only passages whose reading is **settled** (a second reading
that failed is made again later; the passage then comes with its new reading).

| Parameter | |
|---|---|
| `subject` | QIDs of the candidates, 6 at most (`Q124138`: the person in office) |
| `association` | QIDs of the associations or confederations, 20 at most |
| `certainty` | `established`, `uncertain`, `discarded`, separated by commas |
| `since`, `until` | the date of the news (a day, or a moment with its zone) |
| `order`, `limit`, `cursor` | `asc` (default) or `desc`; 1 to 200, 50 by default; the `next_cursor` of the previous answer |

| Field | |
|---|---|
| `id` | of the passage: **what a verdict is sent for** |
| `updated_at` | when it last changed. The cursor goes on from it: a passage that settled, was read again by a changed rule or was told by more news **comes again with the same `id`**, the client replaces what it has |
| `subject`, `association` | the candidate `{qid, name}` and the association `{qid, fifa, name, full_name, confederation, level}` |
| `certainty`, `uncertain_reason` | as above; why it is only uncertain (`readings_disagree`, `rival`, `request`, `reported`, `denied`, `past`, `not_binding`, `ambiguous`...) |
| `reading` | how we read it: `stance` (`for`, `against`, `undecided`, `none`), `level` (`declared`: a bound speaker says it plainly; `probable`: it follows from what is said), `mark` (`official`: told plainly; `reported`: the text itself hedges; `denied`), `speaker_kind`, `speaker`, `quote` (the words that tell it) |
| `sentence`, `matched` | the sentence as published, the words of the association found in it |
| `news` | `{url, title, description, medium, lang, published_at, told_by: {news, media}}` |

The passages are copied whole when they are read, so they outlive the 30 days the news are kept.

## `GET /api/v1/briefing/news` — the cards chosen for all the readers

One item per **story** (a card): the stories the ready briefings of all the readers hold, from the last 45 days. By default (`dedupe=story`) a story is given **once**, at
the first briefing that chose it: the other system judges a news once, not once per reader; `readers` says how many readers have it in a briefing
(as of the moment of the answer). `dedupe=none` gives every choice of every briefing. Read from `briefings.items`: nothing is written, no migration.

| Parameter | |
|---|---|
| `dedupe` | `story` (default) or `none` |
| `topic` | the topic the card was given, separated by commas: `politics`, `economy`, `conflict`, `society`, `technology`, `science`, `health`, `environment`, `culture`, `sport`, `other`. 89 % of the stories are `sport` (all sports, not football alone) |
| `since`, `until` | when the briefing was ready |
| `order`, `limit`, `cursor` | `asc` (default) or `desc`; 1 to 100, 50 by default; the `next_cursor` of the previous answer |

| Field | |
|---|---|
| `id` | the story: **what a verdict is sent for**. A card that joined stories carries `merged_story_ids` |
| `selected_at`, `readers` | when the briefing was ready; how many readers have the story in a briefing |
| `language` | of the lead article |
| `articles`, `articles_total` | its articles, one per medium, **the lead first** (its title is the one **as published**, not our rewrite), 20 at most (a story can hold 269): `{url, title, medium, language, published_at}`; how many there are |
| `key_passages` | the sentences of the lead article the card was written from, word for word, one each |
| `reading.corroboration` | `{media, read, independent, agencies}`: media that tell it, the ones whose text could be read, the ones written apart from the others, the agencies credited |
| `reading.hedged_by` | the word the article itself used to say it has no confirmation (`reportedly`...), else `null` |
| `reading.denied_by`, `reading.official_posts` | who denies it (`by`, `sentence`, `medium`, `url`) and the posts where a party said it itself (`party`, `title`, `channel`, `url`) |
| `reading.topic`, `reading.sourcing` | the topic, and who the article credits (`named`, `anonymous`...) |
| `names` | the people and organisations most of its articles name: `{name, qid, kind}` |

**Never in it:** who the story was chosen for or why (profile, interest, project, thumb, sending date, history), our AI wording, the translations, the title we
may have rewritten, the pictures, and the cards a reader added by hand (a link they pasted may be a private page).

A briefing is given 5 seconds after it is ready, so that two that finish together are both seen by a client that goes on from the time of the first.
The cards are those the briefing was written with: a reader who removes or replaces one afterwards changes nothing to what was given.

## The way back (to be agreed with FootballIQ)

The idea is a loop: we select, the other system judges, **we correct what we show**. What comes back is asked of its authors in a document of its own
([*Ce dont NewsGenerator a besoin en retour*](besoins-en-retour.md)): per `id`, a verdict (`CONFIRME`, `RUMEUR`, `DEMENTI`, `INCONNU`, or `skipped` with a reason), a confidence, how many sources are independent and which one is the origin, the claims in
conflict; for a passage the position the sentence expresses (stance, toward whom, level), whether it is about the association and who speaks and whether he binds it; for a
story its main claim. The route proposed is `POST /api/v1/verdicts`. **Nothing of it is built yet**: the shape depends on what the other system can give. The `id` of each item and the `updated_at` of a passage are
what the way back will refer to.

## Operating

- The FIFA route needs `db/add_fifa_map.sql` run again (it adds `fifa_signals.updated_at` and its index); the briefing route needs nothing.
- Read from the laptop against the database of srv1, the briefing route answers 200 stories in 0.4 s. The code is `routes/v1-router.js`,
  `controllers/{fifa,briefing}-export-controller.js`, `services/{fifa,briefing}-export-service.js`, `models/{fifa,briefing}-export-model.js`; the tests
  are `tests/v1/test.{fifa,briefing}-export.js`.
