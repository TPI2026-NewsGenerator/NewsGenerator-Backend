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
- **Linked to Wikidata.** One loop (`link`): `toLink` takes 20 names never looked for, first the ones a reader
  saw (`wanted_at`, set by a card or the page of a name, `db/add_mentions_wanted.sql`), then the ones named by
  3 news or more (`LINK_LEAST`), the most named first. `exactItems` (`services/utils/wikidata.js`) searches
  `wbsearchentities` in the language of the name, then in English, and keeps the items called exactly so,
  pages of a family or given name aside. `setLink` stores the qid when one item only is called so, `null`
  when none or several ("LFF" of Latvia and of Lithuania). Since 18.10.2026 a person named as several items are
  is the human among them (P31 Q5) in far more Wikipedias than the others (`famousHuman`: 30 at least, 3 times
  the next one; with 10, the byline "Mohammed Ibrahim" became Mo Ibrahim, a businessman in 20): "Donald Trump" is no song, "David Beckham" no Canadian candidate; "Michael Oliver", the
  referee among 9, stays unlinked. An organisation (`organizationItem`, `services/utils/organization-items.js`)
  is the one item called so; else the AI (gemma4:31b, 5 titles of news naming it, `titlesNaming`) chooses among
  the items called so or whose name starts so (`namedItems`: "Juventus" is "Juventus FC", "Liverpool"
  "Liverpool F.C.", the city coming first), no person among them (`describeItems`), or none; kept when the item
  is in 10 Wikipedias at least. About 390 tokens a name, counted in the hourly report of the tagger. One name every 7 s (`LINK_PAUSE_MS`); nothing left:
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
