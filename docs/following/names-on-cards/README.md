# Following > Names on cards

Each card of a briefing shows who it is about: the people and organisations most of its articles name, 4 at
most, each a link to its page (the page of its Wikidata item when the tagger linked it to one, else the page of
the name as written), and the countries they are of. The same names, the rare ones, also find the other
stances of the same actor for the other angles of the card.

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
- **Checked against the card.** A name is linked once for all its news, by its text, so its item may be
  another than the card means ("Primera División" of a Spanish referee the Maltese league, the FMF of a
  Malagasy card Moldova's federation). When the briefing is written (`namesAndCountriesOfCards`),
  `withNamesChecked` (`services/utils/name-check.js`) asks the AI, for each name whose item is in 60
  Wikipedias or fewer (`CHECK_MAX_LINKS`, 39% of the names), whether the titles of the card and the countries
  of the sites that published them fit the item: "no" leaves the link out of the card and of its countries,
  "yes", "unsure", an error or Wikidata not answering leave it. Measured on 242 names of 207 cards judged by
  hand (`bench/card-check`): the 14 wrong ones sent and caught, 2 of 218 right ones left out, about 1 500
  tokens a briefing (`naming` in the report of tokens). The names of the countries are given, not their codes.
- **A name the check sent away is searched again on its card.** "No" leaves the name with no link and no country:
  the FMF of a Malagasy card showed Moldova, then nothing. Its exact search in Wikidata finds nothing for it (the 16
  names of the bench, 0 right; for "FMF" a disease, a gene and the Mexican federation), so `withNamesLinked` takes
  its candidates from the card (`candidatesAfterNo`, `MAX_RELINK` = 10 names a briefing): **A** what the text of the
  card says the name stands for (`expansionOf`: "Fédération malgache de football (FMF)", the words before the
  parenthesis whose initials spell it, that name searched in Wikidata in the language of the lead), **B** the
  Wikipedia search of the name with the country most of its sites are of (`searchedItems`, `wikipedia-search.js`:
  "FMF Madagascar"). The item the check refused is no candidate. The AI then chooses among them as below, with the
  titles, the topic, the other names and the countries of the sites: the card says "Madagascar". Measured on the 12
  wrong links of the bench (`bench/relink-after-no`): 5 right (the Malagasy federation, ACF Fiorentina for "La
  Fiorentina", Feyenoord Rotterdam twice, the Greek Super League), none wrong, 7 with no link (no candidate, no
  country, or the AI saying none); on the 6 right links the check sends away too (UEFA, AFCON, Europe...) none
  replaced by a wrong one. Kept as a candidate the refused item restored 1 of the 6 and gave 1 wrong ("Lega Pro" for
  the Italian league): left out. A name of a card with no country of its sites and no definition in its text gets
  nothing more. A search and a call a name, about 390 tokens.
- **A name with no item chooses on its card.** The link loop keeps, for a person in full or an organisation it
  left with no item, the items it found for the name (`mentions.candidates`, `db/add_mention_candidates.sql`).
  When the briefing is written `withNamesLinked` (`services/utils/name-check.js`) gives the AI, for each
  such name of a card, the titles of the card, its topic, the other names on it and the countries of its sites
  (`linkPrompt`), and the candidates: the one it chooses is the item of the name on this card (a person only in
  2 Wikipedias at least, `PERSON_LEAST`), "0" leaves it with none. At most 60 names a briefing, about 390 tokens
  a name. Measured on the blind bench (`bench/blind`: 240 names drawn at random from 210 cards, judged before
  any system ran): of the 133 names the cards showed with no link 64 right, 4 wrong (namesakes of persons), 65 left
  alone; the whole bench 93% right with the topic, the other names and the countries, 89% with the titles alone.
  A name shown with no candidates kept is looked for again at once (`MentionModel.want`), so the next briefing
  has them.
- **The reader.** A click on a name opens `/following/:qid` or `/following/name/:name`; the names met on
  several cards are suggested on `/following` (see [Names and words](../names-and-words/README.md)).

## The countries of a card

Since 18.10.2026 (an idea of a friend of the user): "Hichilema dismisses his minister" tells nothing to a reader
who does not know he is the president of Zambia. Each card says which countries it is about, under its topic
on the page ("Zambia", "United States · China") and next to its topic in the e-mail, in the reader's language.

- **Where.** `namesAndCountriesOfCards` (`card-names.js`) instead of `namesOfCards` in `write`:
  `items[].countries`, codes ISO 3166-1 ("ZM"), the main first, absent from the briefings before. Client:
  `countryNames` of `client/src/features/briefing/countries.js`; e-mail: `country-names.js` in `briefing-mail.js`.
- **Who votes.** The names of the card with an item (a family name alone only when that person is named in
  full by 100 news at least, `SURNAME_COUNTRY_SEEN`: "Kristal" was an Estonian namesake), the places with an
  item named by a quarter of its articles, and the countries named by their name (`countryNamed`,
  `country-names.js`: "Espagne", "la France", "España", "Ελλάδα" in 37 languages from `Intl.DisplayNames`, plus
  England, Scotland, Wales -> GB). Each weighs the articles of the card naming it.
- **The country of an item.** `readCountries` (`wikidata.js`): a country its own code (P297); a person the
  country it plays for (P1532), else its first citizenship (P27); anything else its country (P17), a part of
  a country (England) the country it is part of. None for an international body (international or
  intergovernmental organisation, supranational union, alliance, regional organisation, international sport
  body, an operating area of the world or a continent, or a part of one (P361): the FIFA Council): FIFA has
  the country of its seat, Switzerland. A body whose parent organisation (P749) is one is not: the French
  federation is UEFA's, and French. A person also has its **bodies** (`bodiesOfClaims`): employer (P108),
  member of (P463), the body of a position held (P39 with P2389, or an employer, membership, affiliation
  written with it), the ones without an end date only.
- **The people of an international body.** A card naming one leaves out the countries of the people of
  that body only: Infantino of FIFA is no Swiss news, Motsepe of the CAF no South African one; the Romanian
  referee of a card naming UEFA, Wenger or Beckham running against Infantino keep theirs.
- **Which are shown.** `cardCountries` (`countries.js`): every country weighing half the first at least, 3 at
  most; none when the title names them all already ("La Zambie limoge...", "le président zambien...").
- **Read once.** `item_countries` (`db/add_item_countries.sql`, `bodies` by `db/add_item_bodies.sql`: the
  rows read before it have none and are read again) keeps the country of each item. A card asks
  Wikidata for the ones never read, 40 at a time, waiting up to 30 s for a pause it asks for; the tagging
  service reads the others ahead, 40 a minute, the most named first (`locate`), with `maxlag=5` (work no
  reader waits for).

Measured 18.10.2026: on 85 cards of 9 briefings, countries on 40 (right ones: Porto and Betis "Portugal ·
Spain", AEK and Shakhtar "Greece · Ukraine", Netflix and the World Cup rights "United States · Spain ·
Andorra"); live briefing 167, 10 cards of 17, none of the FIFA ones.

Measured 19.10.2026 (`bench/international-people`: `bench.mjs`, `truth.json` judged by hand, `score.mjs`):
173 cards of 14 days of briefings name an international body, 84 where the rules tell other countries.
Every person left out (before): 46 right, 38 wrong (the Romanian referee "Italy", Wenger's cards "United
Kingdom" or none, the FIGC, the DFB, the Ghanaian federation without their country). People of a body of
the card only: 63 / 21; with the federations national: **79 / 5** (built). Its links ended or not, or to
any international body (not only the card's): the same or one worse (Malagò, ex-IOC member, lost Italy).
The 5 left are links of names (a Croatian referee taken for a Filipino, "FMF" for Moldova, The New York
Times "United States") and a French journalist quoted on a CAF card.

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
