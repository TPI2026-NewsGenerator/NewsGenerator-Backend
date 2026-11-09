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
  4 at most (`NAMES_PER_CARD`). An item is counted by the articles that name it under any of its writings, once each
  (`itemInCard` of `MentionModel.namesOfArticles`, since 8.11.2026): the Argentine federation of 82 articles was written "AFA" by
  19, in two other ways by 6 and 4, and named by 24; the writing most met alone left it out of the card, and its country with it.
  The same for the places and the countries named. Stored in the briefing: `items[].names = [{name, qid, kind}]`.
- **A person the title says** (`inTitle` of `chosenNames`, since 8.11.2026): a person the lead's title names, linked or named in full,
  is a name of the card from a tenth of its articles (`SHARE_OF_CARD_TITLED`, 2 at least). The card of "El mensaje de Emilio García Silvero"
  had joined four stories (113 articles), 25 of them named him (22%, a quarter being 29): his chip was gone and Infantino's was
  there. Measured on the 593 cards of the last 40 briefings: 6 cards gained a name, 4 right (Trump, Cancelo twice, the Greek
  Infantino), 2 wrong, both a word alone with no item ("Effigy" of "bonfire effigy": the tagger takes a word of a title for a
  person), hence the person in full or linked. Corpus family `cardnames`.
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
- **The words of a name** (`nationalityOf`, `nationalities.js`, since 8.11.2026) vote only for a card that nothing else gives a
  country or a candidate to (all its names international bodies, or without a country): an organisation whose name starts with a
  country ("Eesti jalgpalliliit", "Argentina FA": the first one, two or three words, four letters at least) or has an adjective of
  nationality ("Fédération Algérienne", "Egyptian Football Association", "التحكيم الأردني": `demonyms.json`, the demonyms of the
  countries in 139 languages from Wikidata, one country each, four letters at least, "english" and "british" the United Kingdom;
  `scripts/build-demonyms.js` makes the file). A person (Jordan Henderson) or a place is never read so. Measured on the 590 cards of
  the last 40 briefings (185 without a country): the start of a name added 4 countries, all right (the two-letter "AS" of AS Roma was
  the American Samoa: left out); the adjective added 14, 12 right, one a federation named in passing, one doubtful, and agreed with the
  62 cards that had the country already. The AI still chooses among the candidates. Corpus family `nationality`.
- **A country declined** (`countryDeclined`, `country-names.js`, since 8.11.2026): a place with no item whose name is the name of a
  country with the ending a language with cases gives it ("Hiszpanii", "Srbiji" 4 222 news, "Deutschlands", "Franciaországból",
  "Казахстане", "Μεξικού", "Almanya'da") votes for that country like the name itself. The tagger gives these forms as places of their
  own and Wikidata has no item for them: 1 217 of the 76 946 places met 5 times or more. A name is a country's name, or its first
  letters when it ends with a vowel (`DECLINED_STEM`: 5 letters at least, 4 read "Leeds" as Lithuania, "Perugia" as Peru), with 3
  letters after at most (`DECLINED_ENDING`). Left out: several words, a hyphen or a figure ("India-US"), an adjective of nationality
  (`demonyms.json`), a name two countries start, the "y" of "Norway" taken for a vowel ("Norwalk"), and a word of an English news
  (it has no cases: "Indiana"). 99 of 100 of the forms found were a country; the others are a word that starts like one (Liberci,
  Bolívar, Franchi: known cases of the corpus). Not read: the countries of 4 letters of stem (Rosja, Suomi, Rusko, Iran).
  The languages of the names of the countries grew by Azerbaijani, Uzbek, Kazakh, Belarusian, Macedonian, Catalan, Armenian,
  Georgian, Icelandic, Basque and Galician, and `GB` has "Great Britain", "Großbritannien"... Corpus family `declined`.
- **A place called so by several items of one country** (`placeOfOneCountry`, `wikidata.js`, since 8.11.2026): `placeItem` takes the
  item called so when it stands out (3 times more Wikipedias than the next). Else, when the places called so (a position on Earth, no
  human) with a country hold 80% of the Wikipedias together in one, it takes the best known of that country, if it is in 30 Wikipedias
  at least: the card needs the country, not the exact item. "Corse" is the island (186 Wikipedias) and the Corsican language (108): the
  island; "Barcelona" the city, the club and the province, against a town of Venezuela; "Georgia" the country and the state: none. A
  language, a people, an international body has no country and does not vote. Measured on 136 of the places with no item
  (8.11.2026): 19 linked, all in the right country (Hollywood, Springfield, Sarthe, Fribourg, Cork, "Großbritannien"...), the others
  left (common nouns, a place of two countries). Corpus family `places`.
- **A place looked for again.** 3 595 of the 4 111 places of 50 news or more that had no item were looked for before 22.10.2026, when the
  Wikipedia of their language began to link them (`title-links.js`): 202 of the 400 most met are linked by their title, 2 wrong (the
  Etihad Stadium of Melbourne for the one of Manchester, "Βόλο"). A card that names such a place asks for it again (`MentionModel.want`:
  a place with no item looked for before `PLACES_RULES_FROM`, 9.11.2026), once; the loop links it first (`wanted_at`), so the next
  briefing has its country. Measured with the rules of today on the 33 cards without a country of the last 40 briefings that name a place
  with no item (`bench/places-countries.mjs`, nothing written): 12 gain a country, all 12 plausible (Spain for "Hiszpanii", Jordan,
  France, Wales, Bruges, Lugano, San Siro, Senegal for the Youth Olympic Games...), 7 of them by a country declined. Nothing to run in the
  database; to look for them all at once:
  `UPDATE mentions SET linked_at = NULL WHERE kind = 'location' AND qid IS NULL AND linked_at < '2026-11-09' AND seen >= 3;`
  (the loop takes 50 names a call, about 12 000 a day).
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
  most. Shown even when the title names them: the rule of 18.10.2026 that left them out when it did ("La Zambie
  limoge...") was removed on 06.11.2026, it hid the country of cards the reader had found in the editor.
- **The AI chooses among the candidates.** Rules found one case at a time (a medium, the seat of an international
  body, the people of a body) leave the next case wrong: a card on the World Cup 2026 showed Qatar, "WLA demands
  inclusion in FIFA governance review" Switzerland, a Greek referee's card France (the user, 03.11.2026: a wrong
  country looks unprofessional, none is better). `countryCandidates` (`country-choice.js`) gives, for each card, the
  countries Wikidata found for who and where it names, at most 6, each with what brought it ("L'Équipe (média)",
  "UEFA (organisation internationale, son siège)"; the people of an international body the card names are not offered
  since 8.11.2026, as the rules do not give them: the AI kept Slovenia, for the president of the UEFA the subject of the
  title, in 2 runs of 5 on a conflict of the UEFA with the FIFA, and none of the 67 such candidates of the last 60 briefings
  had been kept);
  `chooseCountries` asks the AI once for all the cards of the briefing which of them the news is about, from its
  titles (3: the title of the card first, then those of its articles, `titlesOfCard` of `card-titles.js` since 9.11.2026: a card that had
  joined four stories gave the AI the titles of the oldest one, all of Infantino's fourth term, and it refused Spain for the card of
  "El mensaje de Emilio García Silvero" 4 times of 4; with the title of the card first it kept it 4 of 4; the check of the names reads
  the same titles) and 350 characters of its sentences: the place it happens, its main actors' country, the country of the
  person or team that is the subject of the title; not the medium that tells it, the seat of a body, a person named in
  passing nor a namesake; none when in doubt, 3 at most. It can only answer a candidate (the code drops any other
  code); a card it does not answer keeps the countries of the rules, and so do all of them when it fails
  (`namesAndCountriesOfCards`, `choose: false` for the rules alone). One call of about 450 tokens per card.
  Measured (`bench/card-countries.mjs`, 150 cards of 14 days, 117 with a candidate): 27 change, 9 to none, 16 to
  fewer countries, 2 with another; read by hand about 20 are better (Qatar for the 2026 World Cup and for the
  CAF president's support of Infantino, Switzerland for the WLA, France for a Greek referee, Belgium added for
  Lens–Club Brugge, Ireland and Spain dropped from the Welsh FA's and Braga's cards), 4 worse (the United States of
  the Fox CEO, Italy of a Corriere dello Sport columnist, France of Wenger's candidacy, the Tunisia of a card told
  by a Tunisian newspaper only), the rest arguable (a player's nationality dropped for his club's country).
- **A medium is a source, not a subject.** A news medium a card names (Wikidata: a newspaper, an agency, a
  channel, a news website, `MEDIA_KINDS` in `wikidata.js`) gives its country only when nothing else on the card
  gives one: "Bomb of the day! L'Équipe: Burleanu could be UEFA's candidate", told by three Romanian media, is
  a card of Romania, not of France (the user, 03.11.2026). Measured on 529 cards of 14 days: of the 12 naming a
  medium, 3 showed the country of the medium and it was not the card's (L'Équipe twice, the BBC); one card (in two
  briefings) lost an Italian country that was right, said by Corriere dello Sport.
- **Read once.** `item_countries` (`db/add_item_countries.sql`, `bodies` by `db/add_item_bodies.sql` and `media`
  by `db/add_item_media.sql`: the rows read before them have none and are read again) keeps the country of each item. A card asks
  Wikidata for the ones never read, 40 at a time, waiting up to 30 s for a pause it asks for; the tagging
  service reads the others ahead, 40 a minute, the most named first (`locate`), with `maxlag=10` (work no
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
- Suggested on 13.10.2026: FIFA, UEFA, CAF, Gianni Infantino for the profile of the referees ([the former README](../../archive/readme-features-2026-10-24.md)).

## A chip in the letters of another language, a place with a preposition

A reader of English saw "ФИФА", "Джанни Инфантино" or "ΟΥΕΦΑ" as chips under an English text (the user, 9.11.2026: "pas qu'il y ait du texte d'une autre
langue dans le briefing"): 76 chips in other letters in 31 of the 80 briefings of the last 20 days. Three causes, all of the family "a name is
spelled as Wikidata does only when the code reads its label":

- **The labels moved to "mul".** Wikidata keeps the name of a person written the same in every Latin language as a label of the language `mul`,
  with none in English (`Q124138`, Gianni Infantino): `wbgetentities` with `languages=en` answered no label and `describeItems` gave the number of the
  item. The calls that read a label now ask with `languagefallback=1` (`describeItems`, `readItem`, `placeItem`, the family names), which gives the
  `mul` label as the English one.
- **A Cyrillic or Greek acronym was kept as an acronym.** `withWikidataSpelling` kept a name in capitals unless it was a word of the label (to keep "UEFA"
  against "Union of European Football Associations"): "ФИФА" was taken for one. A name in the letters of another language is no acronym of the reader's
  and is spelled by its label when the card is translated.
- **A name that is no item cannot be spelled** ("Παναθηναϊκό", "ФК Тиквеш": 31 of the 76): it is left out of the names of the card when it is written in
  the letters of another language than the reader's (`withoutUnreadable`), the text of the card, translated, names it. An item is kept whatever its
  letters: it tells the countries of the card.

The audit of every briefing checks both (`no name a reader sees is written in the letters of another language than theirs`).

A place the tagger gave with the preposition of a headline ("En Corse, l'arbitrage dans le football…" gave the place "En Corse"; Wikidata has no item
of that name, the card had no country) is the place (`withoutPreposition` of `mentions.js`): the prepositions of French (en, au, aux, à), Spanish (en),
Italian (in, nel, nella, nello, nei, nelle) and Portuguese (em, no, na, nos, nas), before a capital only; the "A" of A Coruña, the "Al" of Al Ain and the
"In" of In Salah are words of a name. Applied when a card reads its places and when a place is linked; the places that found no item before 10.11.2026
are looked for once more when a card names them (`PLACES_RULES_FROM`). Rare (27 places so in French among 489 000), common in a French headline.

## A name that is no name

A chip "refereeing" stood on a card of Corsica (the user, 9.11.2026): the tagger had taken "Arbitrage" for an organisation, the AI that links the names without
an item had chosen the item "refereeing" among the ones so called. Of the 924 cards of the last 80 briefings, 377 of the 916 different chips had no item
of Wikidata, and many were no names: the pairing of two teams ("Genoa-Milan", "Real Madrid-Sevilla", 31 of 470 names with no item), a name joined to a
word ("FIFA-Präsident", "Fifa-valg", "DBU-formand", 20), a common noun ("World", "Hotline", "Policija", "Clubs", "Former Referee", 24), a fragment or a declined
form ("FC", "UEFA-e", "Manchesteru City", 17), a word in capitals (8). Two rules, in the spirit of the proofreading (the AI points, the code decides):

- **A concept of Wikidata** (`withoutConcepts` of `card-names.js`): a name linked to an item that is not a person and whose label has no capital letter
  ("refereeing", "public prosecutor's office") is left out. A named organisation has a capital in its label, a brand with a small first letter ("eBay") another
  further on; "bell hooks" is a person.
- **A name with no item the AI says is no name** (`reviewNames` of `services/utils/name-review.js`, at the end of `write()`, with the other readings of the
  cards): one call for the names with no item of the briefing (40 at most a call, with the title of their card), "when in doubt it is a name". Only a name
  with NO item is left out, never one that is linked; an AI that points at more than 60 % of the names (over 6) is not believed; it never fails nor waits
  more than 60 s. What was left out is in the log (`Briefing 512: names: "Genoa-Milan" (match) left out of the card …`) and on the card (`namesLeftOut`,
  shown by `scripts/briefing-audit.js`). `AI_NAME_REVIEW=off` switches it off. The news a reader adds by its link goes through it too.

Measured on the 40 last briefings (`bench/name-review-live.mjs`): 470 names with no item looked at, 100 left out (9 s for the 40, 566 tokens read and 75
written a briefing). By reading the list: almost all are no names; the doubtful ones are acronyms and clubs written in a form of their language ("FAZ", the
Zambian federation, "Gorice", "Comex", "Ланс"): they are chips with no item, so nothing is linked or lost but the chip. It does not point at every declined form
("Manchesteru City" was left out on the second run, not on the first).

## Diagrams

- [Class diagram](following-names-on-cards-class.png) ([source](following-names-on-cards-class.puml))
- [Sequence diagram](following-names-on-cards-sequence.png) ([source](following-names-on-cards-sequence.puml))
- The whole feature: [10-following](../10-following.png), [27-following-sequence](../27-following-sequence.png);
  the briefing: [08b-briefing-cards](../../briefing/08b-briefing-cards.png)

## See also

- [Wikidata items](../wikidata-items/README.md) and [Names and words](../names-and-words/README.md): the pages a name opens.
- [Ingestion > Names](../../ingestion/names/README.md): where the names of the news come from.
- [Briefing > Other angles](../../briefing/other-angles/README.md): what the rare names add.
