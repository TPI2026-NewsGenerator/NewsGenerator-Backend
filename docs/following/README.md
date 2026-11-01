# Following

What a profile follows, in one list and one page (`/following`, `/api/entities`, `services/entity-service.js`):
items of Wikidata (a club, a person, an organisation) and names or words as written, 300 in all
(`MAX_FOLLOWED`, 30 items and 20 words before 2.11.2026). A list of names can be imported from an Excel file.
The news naming one, from every feed and with no relevance, are in the tab "Following" of the briefing page,
searched when it is opened (not part of the briefing), as many as the reader wants for each (10 to 100) going
back up to 30 days to find them, in background for a long list: the news of an item by the names the tagger
found in them and the ones it linked to the item, in any
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
  name, the words added and taken out, the names suggested, how the news of 300 names are searched.
- [Import](import/README.md): a list of names from the first column of an Excel file, looked for in Wikidata,
  followed at once.
- [Names on cards](names-on-cards/README.md): the names a card shows (`card-names.js`), looked for in Wikidata
  first (`wanted_at`), and its rare names finding the other angles (`affair-names.js`).
