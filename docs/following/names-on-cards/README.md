# Following > Names on cards

Each card of a briefing shows who it is about: the people and organisations most of its articles name, 4 at
most, each a link to its page (the page of its Wikidata item when the tagger linked it to one, else the page of
the name as written). The same names, the rare ones, also find the other stances of the same actor for the other
angles of the card.

## Where

- Client: `client/src/features/briefing/components/BriefingCard.jsx` ("Who it is about", `item.names`, each a
  `Link` to `pageOf(name)` of `client/src/features/entities/entityApi.js`), in `client/src/pages/Briefing.jsx`.
- API: written by `POST /api/briefing` (`BriefingService.start` -> `write`, in background), read by
  `GET /api/briefing` (`items[].names`). No route of its own.
- Server: `services/utils/card-names.js`, `services/utils/affair-names.js`, `services/utils/mentions.js`,
  `models/mention-model.js`, called by `services/briefing-service.js`.

## How it works

- **When.** In the step "angles" of `write`, together with the other angles, the official sources and what
  the profile follows; none of them can fail the briefing: names not read, the cards have none (logged).
- **Which names.** `namesOfCards([{storyId, ids, media}])`: for each card `MentionModel.namesOfArticles(ids, 3)`
  gives the names of its news, how many of its articles name each (`inCard`) and how many news name it
  (counted up to 3). `chosenNames` keeps: no place (`location`); a name linked to an item, or named by 3 news,
  or by 2 articles of the card; written as a name (`writtenAsName`: a capital first and last, "Un entraîneur
  légendaire" is no name); never an agency (AFP, Reuters, dpa...), a word like "AI" or "CEO", nor the medium
  of the card itself.
- **One name, one writing.** `asOne` joins the writings of one name: the same qid, one holding the other
  ("Infantino", "Gianni Infantino"), the initials ("PSG" of "Paris Saint-Germain"); the writing shown is the
  one of an item, else the most met.
- **How many.** Named by a quarter of the card's articles at least (`SHARE_OF_CARD`), the most named first,
  4 at most (`NAMES_PER_CARD`). Stored in the briefing: `items[].names = [{name, qid, kind}]`.
- **Wikidata first.** The names shown without a qid get `mentions.wanted_at` (`MentionModel.want`): the
  background looks for them before the others (see [Ingestion > Names](../../ingestion/names/README.md)),
  so a name of a card opens the page of its item within minutes.
- **The rare names, for the other angles.** `storiesOfSameNames` (`affair-names.js`), 5 cards at a time:
  `rareNames` keeps 4 names per card, a person or body (no place) named by 400 news a month at most and by
  news beyond the card, the most named by the card first. Up to 6 names a briefing never looked for are asked
  to Wikidata now (`exactItems`, `setLink`); refused or down, the background does it later.
  `MentionModel.storiesNaming` then finds the stories of the last 30 days (`AFFAIR_DAYS`) naming them or a name
  of the same item, at least 0.45 close to the card by their centroids, 13 per card at most; they join the
  closest stories the AI judges (see [Briefing > Other angles](../../briefing/other-angles/README.md)).
- **The reader.** A click on a name opens `/following/:qid` or `/following/name/:name`; the names met on
  several cards are suggested on `/following` (see [Names and words](../names-and-words/README.md)).

## Measured

- The Latvian federation backing Čeferin (13.10.2026): its backing of Infantino a week before was 0.60-0.65
  away when "Čeferin runs again" in 15 languages was 0.80-0.89. Of the 21 stories naming the LFF, the same fact
  was at 0.91, the stances on Infantino's candidacy at 0.64-0.65, the Lithuanian ones (the other LFF) at
  0.37-0.58: hence the stories naming a rare name taken from 0.45, the closest first (`affair-names.js`).
- Suggested on 13.10.2026: FIFA, UEFA, CAF, Gianni Infantino for the profile of the referees (server/README.md).

## Diagrams

- [Class diagram](following-names-on-cards-class.png) ([source](following-names-on-cards-class.puml))
- [Sequence diagram](following-names-on-cards-sequence.png) ([source](following-names-on-cards-sequence.puml))
- The whole feature: [10-following](../10-following.png), [27-following-sequence](../27-following-sequence.png);
  the briefing: [08b-briefing-cards](../../briefing/08b-briefing-cards.png)

## See also

- [Wikidata items](../wikidata-items/README.md) and [Names and words](../names-and-words/README.md): the pages a name opens.
- [Ingestion > Names](../../ingestion/names/README.md): where the names of the news come from.
- [Briefing > Other angles](../../briefing/other-angles/README.md): what the rare names add.
