# Following > Wikidata items

A profile follows clubs, people and organisations as Wikidata knows them, 300 in all with the names followed as written. Each item brings its names
in the languages read (an alias of one common word left out, a club also without its "FC"), its links still
true (the players and the coach of a club, the team of a player, the chair of a body), and a page with the news
of the window naming it or its links, from every feed, with no relevance. Its news are in the briefing, in the
tab of what the profile follows, unless the reader unticks it.

## Where

- Client: `client/src/pages/Following.jsx` (`FollowingPage`, `/following`: the search box, the items followed,
  "in the briefing"), `client/src/pages/Entity.jsx` (`EntityPage` and its `Names`, `/following/:qid`: the news
  of the item and of its links, the window, the names), `client/src/features/entities/entityApi.js`
  (`EntityApi`), `client/src/features/entities/kinds.js`.
- API (`routes/entity-router.js`, `controllers/entity-controller.js`): `GET /api/entities`,
  `GET /api/entities/search?q=`, `POST /api/entities {qid}`, `GET /api/entities/:qid?hours=`,
  `PUT /api/entities/:qid/names {added, removed}`, `PUT /api/entities/:qid/briefing {on}`,
  `DELETE /api/entities/:qid`. The search, a follow and the page are 30 a minute per reader (`wikidataLimit`);
  every route but the list and the search needs a profile (`needsProfile`).

## How it works

- **Search.** `EntityService.search` (`services/entity-service.js`) asks `searchItems`
  (`services/utils/wikidata.js`): `wbsearchentities` in the language of the reader, 8 items at most. The
  client asks 400 ms after the last key, from 2 letters. Wikidata down: 502.
- **Follow.** 300 names at most with the words (`MAX_FOLLOWED`, 30 items before 2.11.2026). `loaded` takes the row of `entities` when it was read in
  full in the last 7 days (`REFRESH_DAYS`), else `readItem`: `wbgetentities` (labels, aliases, descriptions,
  claims in en, fr, de, es, it, pt, nl and the reader's language), the kind from P31 (`kindOf`), the short
  name P1813, the family name of a person (P734, 4 letters at least), and a SPARQL query of its links without
  an end date (coach, league, chair, owner, team, member of, party...; the players of a club or team who
  joined in the last 6 years), 80 at most. Wikidata down: the row known is used, else 502; links not read:
  the ones known are kept.
- **Its names.** `namesOf` (`services/utils/wikidata-names.js`): the labels, the extra names and the aliases
  that are usable (two words or more, or one acronym, or a figure: "PSG", "Schalke 04", never "Paris"), in
  Latin letters, once each; for a club the names without "FC" too.
- **Saved.** `EntityModel.save`, one transaction: the row of `entities` (`fetched_at`), the linked items
  added with their label only, `entity_links` replaced (`db/add_entities.sql`). The follow is a row of
  `profile_entities`, `in_briefing` true by default (`db/add_follow_in_briefing.sql`).
- **The reader's names.** `setNames`: 10 names of their own at most (2 to 60 characters, `added_names`), and
  names of Wikidata taken out (`removed_names`); `namesFor` merges them.
- **The page.** `page(profileId, qid, hours)`: hours from 24 to 168, by days (`ENTITY_HOURS`); the links one
  per item, 60 searched (`MAX_LINKS_SEARCHED`). `namedNews` finds the news of the feeds of the profile
  (`feedsOf`) naming its names or its qid: `MentionModel.articlesNamed` by the names the tagger found and the
  ones it linked to the item, in any language; while news of the window wait for the tagger
  (`anyUntagged`, older than 10 minutes), `FeedModel.articlesHolding` looks for the names with and without
  their accents in the texts of those it has not read (`untagged`, the index `i_articles_untagged`; 28 news
  instead of 12,683 for the UEFA on 30 days), checked as whole words. `newsOfTerms` and `mergeNews`: one
  news per story, the newest first, every story counted, 30 news kept per link. The result is kept 10 minutes.
- **In its tab.** `briefingGroups(profileId, hours, {limit, only})`: the items with `in_briefing`, all in one search
  (see [Names and words](../names-and-words/README.md)), each its `limit` newest news (100 by default), all
  counted over the last `hours`; the tab calls it for 1, 2, 4, 8, 16 then 30 days and reads again only the items
  (`only`: their qids) with fewer stories than the reader wants (`untilEnough`). The tab shows them under the
  item's short name (`shortName`: "UEFA"). Measured for the profile following Čeferin and Rosetti: 90 and 2
  stories in 30 days (4 and 0 in 7, 0 and 0 in 2), 0.8 s, 44 KB.
- **From a list.** An item followed from an imported list has its row with its label alone (`EntityModel.addNamed`,
  `fetched_at` null, as a link only met): read in full in background, one after the other
  (`fillItems`, three calls each), so that its names, kind and links come in minutes. See [Import](../import/README.md).

## Measured

- Looking for the names of a club and its people in the texts: 45 names took 387 s with the patterns of the
  terms followed, 11 s as plain texts the trigram index answers (`bench/entity-explain.mjs`, 48 hours).
- Counting by the tagger's names: the page said 101 stories for the UEFA where its name alone had 152, 100
  news having been kept per name, then counted ([the former README](../../archive/readme-features-2026-10-24.md)).
- Wikidata let about 10 searches a minute through on 13.10.2026; with a User-Agent naming the client the limit is 200
  a minute (86 went through in a minute, 27.10.2026): see [Ingestion > Names](../../ingestion/names/README.md).

## Diagrams

- [Class diagram](following-wikidata-items-class.png) ([source](following-wikidata-items-class.puml))
- [Sequence diagram](following-wikidata-items-sequence.png) ([source](following-wikidata-items-sequence.puml))
- The whole feature: [10-following](../10-following.png), [27-following-sequence](../27-following-sequence.png);
  the client: [client-06-following](../../../../client/docs/following/client-06-following.png)

## See also

- [Names and words](../names-and-words/README.md): what is followed as written, and the page of a name.
- [Names on cards](../names-on-cards/README.md): the names of a card, opening the page of their item.
- [Ingestion > Names](../../ingestion/names/README.md): the tagger and the names linked to Wikidata.
