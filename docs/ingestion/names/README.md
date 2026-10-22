# Ingestion > Names

Every news read gets the people, organisations and places it names, found by a tagger of its own
(`ner/server.py`, GLiNER), and the names met often are looked for in Wikidata. The reader never sees this work
directly: it is what lets the page of an item find its news in any language, what puts names on the cards, and
what finds the other angles of a card through its rare names.

## Where

- No page: background loops started by `server.js` (`TaggingService.schedule()`, `services/tagging-service.js`),
  next to the runs of the ingestion, unless `INGEST_IN_SERVER=false` or `NER_URL` is empty.
- `pnpm run ner` starts the tagger (`127.0.0.1:8021`); `pnpm run ner:status` gives the news tagged and waiting,
  the pace and the names linked to Wikidata.
- The readers of the names: [Following > Wikidata items](../../following/wikidata-items/README.md),
  [Following > Names on cards](../../following/names-on-cards/README.md), and the other angles of a card.

## How it works

- **One loop per tagger.** Each address of `NER_URL` (`taggerUrls`, `services/utils/tagger.js`) works on its
  own: `taggerDevice` asks `GET /health` (2 s), then `tagBatch` takes the newest news not tagged
  (`entities_at IS NULL`) of the last 30 days (`TAG_DAYS`, the retention), 16 on a processor and 128 on a
  graphics card (`BATCH`), none another tagger of the process is reading (`taken`). Off, failing or with
  nothing left: asked again after 60 s (`WAIT_MS`).
- **What is tagged.** `textOf`: the title and 700 characters of the description (`TAGGED_CHARS`), each text
  once. `tagTexts` posts them to `/entities` (280 s at most, `NER_TOKEN` or else `EMBEDDER_TOKEN`).
- **The tagger.** `ner/server.py`: `urchade/gliner_multi-v2.1`, labels person, organization, location,
  threshold 0.5, 1000 characters a text and 256 texts a request at most, fp32.
- **Cleaned.** `cleanMentions` (`services/utils/mentions.js`) keeps each name once per kind, under its key
  (`mentionKey`: small letters, no accent, no quote around it, no English "'s", no leading article when two
  words are left); a name over 120 characters is dropped; an acronym inside a longer name ("UEFA" of "UEFA
  Nations League") is added as an organisation.
- **Saved.** `MentionModel.save` (`models/mention-model.js`), one transaction: the news are marked
  (`entities_at = now()`) with `FOR UPDATE SKIP LOCKED`, so a news the grouping holds is left for later; the
  names go in `mentions` (`UNIQUE (key, kind)`, `seen` counted up), in the order of their key so that two
  taggers wait for each other instead of locking each other; each news says which it names in
  `article_mentions` (`db/add_named_entities.sql`, index `i_articles_untagged` in `db/add_untagged_index.sql`).
- **Linked to Wikidata.** One loop (`link`): `toLink` takes 50 names never looked for, first the ones a reader
  saw (`wanted_at`, set by a card or the page of a name, `db/add_mentions_wanted.sql`), then the ones named by
  3 news or more (`LINK_LEAST`), the most named first, the persons of one word last. Since 22.10.2026 the
  persons in full and the places among them are first linked at once by the title of an article of the
  Wikipedia of their language (`linkedByTitle`, `services/utils/title-links.js`: `action=query&redirects=1`,
  50 titles a call, English for the ones not found, without the pause, Wikidata being searched name by name only
  for the others): kept when it is no page of homonyms, the item a human (a person) or a place (a place), called
  no common noun, and a person not a byline. 41% of 300 names of the queue, 90% right (`bench/title-batch`):
  the queue of 285 000 names, at the 12 000 a day Wikidata lets through, would otherwise take weeks. The
  organisations stay with the AI (3 of 16 wrong by title: "Napoli" the city). A name the loop leaves with no item keeps its candidates (`mentions.candidates`, `[]` when it found none) for the cards to choose among them (see [Names on cards](../../following/names-on-cards/README.md)), and a name shown on a card with none kept is put back in the queue at once (`want`). Reported hourly (`names linked by
  the title of their article`). `exactItems` (`services/utils/wikidata.js`) searches
  `wbsearchentities` in the language of the name, then in English, and keeps the items called exactly so,
  pages of a family or given name aside: the text found, or since 20.10.2026 the label too (Wikidata gives
  the longest name starting so, "Javier Tebas Medrano" of the Spanish label for "Javier Tebas", met 668
  times and never linked; `bench/label-items/relink.mjs` found the persons to look for again). `setLink` stores the qid when one item only is called so, `null`
  when none or several ("LFF" of Latvia and of Lithuania). Since 18.10.2026 a person named as several items are
  is the human among them (P31 Q5) in far more Wikipedias than the others (`famousHuman`: 3 times the next
  one, 10 at least since 19.10.2026, 30 for a byline: a name one site writes 80% of the news of, as the
  byline "Mohammed Ibrahim" of a sports site, which became Mo Ibrahim, a businessman in 20; `mediaOf` in
  `services/utils/country-names.js`, the sites from `sitesNaming`). None standing out, the one standing out
  among the humans of the country of the media naming the person, by the domains of their sites (half of the
  news of sites of a country at least): "Istvan Kovacs" of prosport.ro and gsp.ro is the Romanian referee
  (31 Wikipedias), not the Hungarian boxer (22). For a full name only ("Russell" alone, the F1 driver, became Bertrand Russell: a family name alone is told on its
  card): "Donald Trump" is no song, "David Beckham" no Canadian candidate; "Michael Oliver", the referee
  among 9, stays unlinked. The one item called so of a person (`personItem`, `services/utils/person-items.js`,
  since 20.10.2026) only when it is a human (P31 Q5: "one person" was a reasoning agent, Kim Jong Un a song)
  in a Wikipedia at least (`describeItems`); in none, or for a family name after a particle ("De Roon", a
  botanist; `familyName`), when the AI (gemma4:31b, 5 titles, the description and country of the item) says
  the news fit it: "Eduardo Varela", a Uruguayan referee, is no Mexican journalist in no Wikipedia. About 270
  tokens a name. A word alone (since 21.10.2026) keeps its item only when the item is a human called exactly so
  and in 20 Wikipedias at least (Pedri, Deco, Sheamus); else it has no link of its own and its card tells it, by
  the person linked in full whose name ends with it (`withSurnamesLinked`, which acts on a word with no link
  only): the one item called so was wrong 87 times of 174 judged on the titles of their news (a botanist for
  Feijóo, a painter for Evenepoel, the actor Giancarlo Esposito for the footballers) and stopped the card from
  telling it. 107 right and 7 wrong against 87 and 87 (`bench/single-words`). An organisation (`organizationItem`, `services/utils/organization-items.js`)
  is the one item called so when it may be a body (since 20.10.2026): no human, no place, no work, in 2
  Wikipedias at least (`describeItems`: a place has a population, P1082, or a position, P625, and nothing of a
  body, no seat, league, sport, industry..., or is a bare human settlement, Q486972; a country, with a code
  ISO, is none; a work has a date of publication, P577), and since 21.10.2026 the sites naming it are not of
  another country (`ofOtherCountry` in `country-names.js`: sites with a country write 20 news of it at least
  and one other country 70% of them, or none is of its country, the United States excepted, having no domain
  of its own): "OL" of French sites is Lyon, not Open Library, the French "Assemblée nationale" not Senegal's,
  "Primera División" of Spanish-speaking sites not the Maltese league (`bench/org-country`: 9 of 75 asked to
  the AI, which kept the 5 right and said none for the 3 wrong). "Al-Hazm", the Saudi club, was a settlement
  in Oman, "EU" the commune of Eu. Else the AI (gemma4:31b, 5 titles of news naming it, `titlesNaming`) chooses among
  the items called so or whose name starts so (`namedItems`: "Juventus" is "Juventus FC", "Liverpool"
  "Liverpool F.C.", the city coming first), no person among them, or none; kept when the item is in 10
  Wikipedias at least, 1 when one item only was called so (the AI agrees it is the one: Instagram, a work,
  ChatGPT, the European Union, a population). About 390 tokens a name, counted in the hourly report of the
  tagger.
  A place (`placeItem`, since 18.10.2026): a country is the item of its code ISO (`countryNamed`, then a
  search `haswbstatement:P297=CN`): the search shows the People's Republic as "China PR", the item called
  "China" is the cultural region. Another place is the one item called so by its name or one of its other
  names in the language of the news or in English (`labels|aliases` of the 10 found: the search shows one
  writing per item); of several, the place (a position, P625, no human) in 3 times more Wikipedias than the
  next one, 30 at least (`famousPlace`): "Paris" is the capital, not Paris in Texas. One name every 7 s (`LINK_PAUSE_MS`); nothing left:
  10 minutes. A 429 or "too busy" pauses every call of the process to Wikidata for `Retry-After` or 30 s.
- **A family name alone** on a card (`withSurnamesLinked`, `services/utils/card-names.js`, since 18.10.2026):
  "Infantino" is no item of Wikidata (a family name, a village, a page of namesakes). It is the person linked
  whose name ends with it (`MentionModel.personsEndingWith`, read through the index of the names linked),
  when that one is met 3 times more than any other so named, and a person whatever the tagger took it for
  on that card, when the tagger takes that word for a person most of the time ("Infantino": a person 1,194
  times, an organisation 329, a place 124). A club named like someone ("Milan", a cyclist) stays a club.
  The card keeps its writing of the name.
- **Report and housekeeping.** Every hour the log says what each tagger did and what is left
  (`untaggedCount`); once a day `deleteUnused` deletes the names no news names any more that were never looked
  for in Wikidata. The ones looked for are kept on purpose, whether a news still names them or not (the user,
  17.10.2026): a name that comes back keeps its item and is not looked for again in Wikidata.

## Measured

- 294 news of 26 languages (`bench/ner`, 13.10.2026), on 3 cores of the server: 2.2 news a second, the same
  names run after run; the title alone was 3 times faster but found 44% of the names; in int8 (ONNX or
  PyTorch) it found none: fp32 only. The news of the day come at about 1.4 different texts a second; a
  graphics card tags about 130 a second.
- In Docker on 2 cores at `--cpu-shares 64`; with 3 cores it took the embedder from about 7,900 news an hour
  to 5,300-5,900 (13.10.2026).
- Acronyms (`bench/ner-recall.mjs`, 2662 news of 30 days): the names of the UEFA were in 72 of the texts the
  tagger read and in 35 of its names.
- 18.10.2026: of the 1,072 persons and organisations met 500 times or more, 263 were linked: one item only
  called so left out the famous ones, who have the most namesakes (FIFA: an album and a song of Angélique
  Kidjo; Manchester City: its women's team). On 40 of them never linked, the persons told apart by
  `famousHuman` were 4 out of 4 right; the organisations by their Wikipedias only 9 out of 14 (Liverpool and
  Roma the cities, Juventus a basketball team), by their description against their news 7 out of 16: the AI
  chose 50 times, 45 right, 44 out of 46 kept in 10 Wikipedias or more (a PSG omnisport club in 4, the
  women's team of Como 1907 in 6 left out). Live: Juventus, Liverpool, FIFA linked; Roma (AS Roma is no
  candidate), "FC" and Real Madrid (news of its basketball team) none.
- Persons, 19.10.2026 (`bench/homonyms`): 67 full names never linked (the 70 most named, 70 at random of 5
  to 200 news, the ones with namesakes judged by hand) with "Istvan Kovacs" and "Mohammed Ibrahim". In 30
  Wikipedias for every name: 5 right, none wrong, 54 missed; in 10: 33 right, 1 wrong (the byline); in 10
  with the threshold of 30 for a byline: 32 right, none wrong; with the country of the media too: 35 right,
  none wrong (Pedro Sánchez, Daniel Dubois, Istvan Kovacs). In 5: 40 right, none wrong, kept out: the
  threshold of the bylines is close ("Matthew Robertson", 79% of one site). Twice the next one instead of 3
  times linked Ben Johnson, the coach of the Bears, to the actor. Missed: the famous with famous namesakes
  (José Mourinho 110 against 71, Carlos Alcaraz, George Russell, Pep Guardiola, Charles Leclerc).
- Persons linked to the one item called so, 20.10.2026 (`bench/lone-items`: `items.mjs` read the Wikipedias of
  the 7,968 items full names were linked to, 2,856 in 0 to 9, 255 in none; `bench.mjs`, `ai.mjs`, `truth.json`
  by hand, `score.mjs`). In 0 to 9 Wikipedias (famousHuman links none of them): of the 60 most met 3 wrong, of
  60 at random 8, of 40 at random in no Wikipedia 23 (footballers "researchers", Zverev a Russian priest,
  bylines poets and physicists): 123 right, 38 wrong. A human only: no loss, 17 wrong out ("Le conducteur",
  "business leaders" paintings, films, episodes). In 1 Wikipedia at least: 105 right, 2 wrong (De Roon, De
  Luca), 17 lost, all in none. 2 at least: 10 more lost (Mike Norvell, Ian Rapoport), none wrong left of
  these; 5 or 10 lose half or all. The country of the item against the one of the media: most news are of a .com,
  the American players of sports.yahoo.com "Canadian": 18 right lost. The AI for every item: 118 right, 3
  wrong (bylines), 4 lost (Edouard Geffray, a stale description, the vandalised one of Horatiu Fesnic). Built:
  a human in 1 Wikipedia, the AI for one in none and for a family name after a particle: 116 right, none
  wrong, 6 lost (items with no description, Christine Villemin); of 5 more family names (Van Hecke, a Flemish
  painter in 9, Di Battista a musician in 9), the 4 wrong refused, La Joaqui kept.
  Not built: famous family names after a particle linked in many Wikipedias ("Van Dijk" a Baroque painter in
  84, "De Wever" a climate activist, "De Laurentiis" Dino), nor the 1,254 persons of one word linked.
- Organisations linked to the one item called so, 20.10.2026 (`bench/lone-organizations`: `items.mjs` read the
  8,486 items 10,921 organisations were linked to, their classes and properties; `bench.mjs` searched again what
  is called so, 190 organisations, the 20 most met, 100 at random, 70 at random of the items a human, a place,
  a work or in 0 to 2 Wikipedias, and what the AI chose instead; `truth.json` by hand, `score.mjs`). 123 were
  linked to the one item called so (3 of the 20 most met: the others the AI chose among several). Judged 122:
  93 right, 6 of the right country only (Tottenham the town, Sarnese the village of the club, the credit union
  TDECU), 23 wrong (Al-Hazm, "EU" the commune of Eu in 57 Wikipedias, "NI" Lower Saxony, "Jambos" a genus of
  plants, "Fivers" an album, "Pogacar" an article of an encyclopedia, "EE. UU" a Wikinews article). Asking the
  AI as among several (kept from 10 Wikipedias): no human 22 wrong left; a position on Earth 12 wrong, 3 lost
  (LAWMA, the FIFA Council); 1+ Wikipedias 15 wrong; 3+ 8 wrong, 21 lost. Its choice kept from 1 Wikipedia when
  one item only was called so (it agrees with the news): no human, place, work, 2+ Wikipedias, 96 right, 3 of the
  country, 1 wrong (ENC, the École des chartes, in 44), 6 lost (PFL Chicago, Verifactu, the Nigerian students'
  union: the AI says none; gut bacteria; Lamine Yamal, a human tagged a body); 1+ Wikipedias 3 wrong (Pogacar,
  Scarlet Knights comic book characters), 3+ one more lost. The AI for every one: none wrong but 12 lost
  (Shakhtar Donetsk: "only when you are sure") and 5 times the calls; with the rule 1 lone item in 5 goes to it.
  Al-Hazm's settlement has no position nor population, only its class: a bare human settlement is a place too
  (one item of the 8,486). Live: Al-Hazm the club Al Hazem SC, Tottenham Hotspur, ES Troyes AC for "ESTAC",
  Samsung the group (a brand in 1 Wikipedia), the Cincinnati Bengals (a team of 1937); Instagram, TikTok,
  ChatGPT, the European Union given back by the AI; Lang & Schwarz lost. 1,594 organisations (1,198 seen 20
  times or more) to look for again: `bench/lone-organizations/relink.sql`, to run after the deploy.
- Places, 18.10.2026: 1,730 of the 9,496 named by 20 news or more were linked. On 50 never linked (the 25
  most named, 25 at random), `placeItem` linked 22 of the 25 (Paris, France, China the People's Republic,
  London, Rome, Madrid; Washington and New York the states: Wikidata calls the cities "Washington, D.C." and
  "New York City", never "Washington" nor "New York") and 13 of the 25, none wrong ("Colonia" in Italian is
  Cologne); Cork, Kabul and Fairfax, a city and a county or province both known, stay unlinked. The 10,585
  places looked for before were looked for again.
- Wikidata without an account let 9 or 10 searches through then answered 429 for 12 to 25 s; one every 6.5 s
  went through 30 times in a row (13.10.2026): one every 7 s, about 12,000 names a day, for about 150,000
  waiting.

## Diagrams

- [Class diagram](ingestion-names-class.png) ([source](ingestion-names-class.puml))
- [Sequence diagram](ingestion-names-sequence.png) ([source](ingestion-names-sequence.puml))
- The whole ingestion: [04-ingestion](../04-ingestion.png), [24-ingestion-sequence](../24-ingestion-sequence.png);
  the names as the reader meets them: [10-following](../../following/10-following.png)

## See also

- [Stories and threads](../stories-and-threads/README.md): the grouping whose rows the tagger skips.
- [Following > Wikidata items](../../following/wikidata-items/README.md), [Following > Names and words](../../following/names-and-words/README.md), [Following > Names on cards](../../following/names-on-cards/README.md).
- [Briefing > Other angles](../../briefing/other-angles/README.md): the stories found by the rare names of a card.
