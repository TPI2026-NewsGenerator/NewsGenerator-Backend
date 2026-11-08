# Testing > The corpus of regression

A briefing is made of many small rules (the language of a title, the check of the figures of a translation, the spelling of a name,
the cut of a text into sentences...) that each hold on the cases they were written for and break on the next one. The corpus
is one list of real, hard cases, run at every change, so that a rule fixed for one card is not undone by the next feature.

The rule of the project: **a problem reported on a card adds its case to the corpus first (it fails), then the logic is fixed
(it passes).** The card itself is never the target: it was read and sent already. The case keeps the family of the problem.

## The three layers

| Layer | What | When | Command (from `server/`) |
|---|---|---|---|
| Offline | `tests/regression/corpus.json` run by `tests/regression/regression.test.js`: the logic with no AI, a test a case, named by it | every change, with the other tests (a few seconds) | `pnpm run regression` |
| Live | the `live` cases of the same file asked of the real model by `bench/regression-run.mjs`: translations (dates, names, figures, languages), the language of a title with a wrong label, and rewrites of titles, checked by what they must hold, not by an exact text | before a deploy, or after a change of a prompt or of the model (about 1 minute, 16 000 tokens) | `pnpm run regression:live` |
| Briefing | `scripts/briefing-audit.js <id>` (or `<file.json> <profileId>` for a briefing never saved, as `bench/enzo-measure.mjs` writes it): a briefing already written, checked against the same lessons (the title, text, key points and digest of a card in another language translated, no sentence left in its language, how many are translated with a ⚠, a picture on every card...), and its shares of cards with names, countries, angles, picture, AI version and its time, against the 3 before; and why the cards without a country have none (no name, names with no item, international bodies and their people, a country not read yet, a country the rules gave and the AI refused) | after a deploy, on the first briefing written | `pnpm run audit -- <id>` |

The offline layer needs no database nor key. The live runner saves its scorecard in `bench/data/regression/` (not kept in
git, like the other benches) and says what held before and fails now, and the reverse. The audit writes nothing.

## What the corpus holds

206 offline cases and 19 live ones, in families, most of them taken from the briefings of 6.11.2026:

| Family | Asks of | Cases came from |
|---|---|---|
| `language` | `titleLanguage`: the language of a title from its letters and its label | angle badges read Norwegian, Galician, Catalan for German, Portuguese, Spanish; Polish read Catalan, Czech Slovenian, Slovak Bosnian; Serbian read Slovenian, Slovenian read Bosnian; the scripts |
| `figures` | `keepsFigures`: a translation keeps every figure | Vietnamese dates 5/11, 20/2 to 20/6, times, rounds, thousands, a figure lost or changed, the units of number (Korean 만 억 천, Japanese and Chinese 万, "2 million" and "2 000 000") |
| `dateline` | `splitSentences`: the dateline of an article leaves its first sentence | "November 6 –", weekday, year, time, place, and what is no dateline (a score, a range, a timeline) |
| `sentences` | `splitSentences`: where a text is cut | German ordinals ("am 5. November", "21. Spieltag", "90. Minute"), abbreviations, glued sentences |
| `names` | `alignNames`: a translated name as Wikidata spells it | Lekjaâ, Modrić, Čeferin, a consonant dropped, a vowel that is another person |
| `ifthen` | `withCleanNext`: the small letter after "If" and "then" | Talks, A change, The CTA, Kozo Tashima, FIFA, German nouns, French |
| `romanized` | `withSurnamesLinked`: a person in Greek or Cyrillic letters linked to the person whose family name has the same Latin letters | "Τζιάνι Ινφαντίνο" (Wikidata: "Τζάνι"), Μέσι (one s), ντ as d or nt, Мбаппе, a Gerd among two Müllers, and what is left alone (another given name, two persons as met, a person met twice, an organisation) |
| `chips` | `tidyNames`: the names a card shows | `KFA는`, `FIFA-e`, `Arsenala`, `Bayerns` and what is not a form of a name (Sportal, Marcas, Villarreal-PSG, a person), `KFA` an alias in Korean, "Ceferin" and "Čeferin" |
| `cardnames` | `cardNames`: the names chosen for a card from the mentions of its articles | the Argentine federation of 82 articles written three ways (19, 6, 4) and named by 24, an item named three ways by the same 8 articles, a person of the title under a quarter of the articles (Silvero), and the word of a title that is no person (Effigy) |
| `declined` | `countryNamed`, `countryDeclined`: the country a place is by its name declined | "Hiszpanii", "Srbiji", "Deutschlands", "Franciaországból", "Казахстане", "Μεξικού", "Almanya'da", "Großbritannien", and what is not one (Indiana, Australian, Chinatown, Germantown, Norwalk, Perugia, India-US); known: Liberci, Rosji |
| `places` | `placeOfOneCountry`: the item of a place called so by several items of one country | "Corse" (island and language), "Barcelona", "Lens", and what is left ("Georgia": two countries, little known places, no country) |
| `nationality` | `nationalityOf`: the country the words of an organisation's name say | "Eesti jalgpalliliit", "Argentina FA", "Fédération Algérienne", "التحكيم الأردني", and what is not one (AS Roma, Congo RDC, a person, a country, two countries' adjective) |
| `following` | `searchNamesFor`: the names a person is followed by | Velasco (common), Čeferin and Rosetti (their own), García, the words the reader added |
| `neutral` | `checkRewrite`, `neutralTitle`: the checks of a neutral title | the FA case (name lost), exclamation, figure, negation, question, quotation, a good rewrite, a teaser taken out |

A case marked `known` shows a weakness of the words and letters alone (today: a Slovenian title of names and č, š, ž with no word
of its own, in a feed whose label is wrong: nothing tells it from Bosnian, franc guesses). Its test is expected to fail and fails when it
starts to pass, so the mark is taken off. The weakness is covered in the briefing by the AI that translates the title: for a title whose
language was only guessed (`guess: true` in `translateTexts`), it says in the same answer the language it is really written in
(`languages`, a few tokens), and `translatedTitles` takes it: the live cases `live-languages-*` hold that. Serbian, Croatian, Bosnian and Slovenian in Latin letters are told by
the label of the feed when it is one of them, else by the short words that only one side writes (`balkanLanguage` of `language.js`).

## Validated on the code of before

The offline corpus was run on the code of before the corrections of 6.11.2026 (commit `b44d4ef`): 36 of its first 91 cases fail
(language 7, figures 3, dateline 8, sentences 3, names 5, if/then 10). It had also shown, while it was being written, three
defects nobody had reported: the German ordinals cut a sentence in two (and the first part lost its date), a Macedonian title of a
Macedonian feed read Bulgarian, and a Polish or a Czech title read Catalan or Slovenian.

## Adding a case

1. Put the case in `tests/regression/corpus.json` (`cases` for the offline logic, `live` for the real model): an `id`, a `family`,
   the `origin` (the card, the briefing, the date), an `input` and what is `expect`ed. A title or a short passage, not an article.
2. Run `pnpm run regression`: it must fail, for the reason of the report.
3. Fix the logic, never the card. The case passes.
4. A family that does not exist yet needs its line in `FAMILIES` of `regression.test.js`.

The articles are protected: the corpus keeps titles and passages of a sentence or two, for the use of the project only.

## Limits

- The offline layer does not ask the AI: what the AI writes (a rewrite, a translation) is only checked by the live layer, and
  by what the code checks of it (figures, names, quotations).
- The live layer is not a measure of quality: it holds what must hold in any good answer, and says when it stops holding.
- The audit sees one briefing: the cases of the corpus are the memory.
