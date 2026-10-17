# Following

What a profile follows, in one list and one page (`/following`, `/api/entities`, `services/entity-service.js`):
items of Wikidata (a club, a person, an organisation, 30 at most) and names or words as written (20 at most).
Every news of the window naming one, from every feed and with no relevance, is in the briefing, in a tab of its
own: the news of an item by the names the tagger found in them and the ones it linked to the item, in any
language; the news of a word by their text. Each card of a briefing also shows the people and organisations it
is about, each opening its page, and the names met card after card are suggested.

## Overview diagrams

- [10-following](10-following.png) ([source](10-following.puml)): the modules, from the routes to Wikidata and
  the tagger.
- [27-following-sequence](27-following-sequence.png) ([source](27-following-sequence.puml)): the names of the
  news, an item searched and followed, its names, its page, its news in the briefing.
- The client: [client-06-following](../../../client/docs/following/client-06-following.png).

## Sub-features

- [Wikidata items](wikidata-items/README.md): searched, followed, read from Wikidata with their names and
  links, the names the reader adds or takes out, in the briefing or not, the page of an item.
- [Names and words](names-and-words/README.md): what is followed as written (`watch_terms`), the page of a
  name, the words added and taken out, the names suggested.
- [Names on cards](names-on-cards/README.md): the names a card shows (`card-names.js`), looked for in Wikidata
  first (`wanted_at`), and its rare names finding the other angles (`affair-names.js`).
