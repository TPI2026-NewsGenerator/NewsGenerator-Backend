# Briefing > Key passages

The default way to read a card: 2 to 5 sentences of the article, about 170 words at most, **word for word as the
article published them**. The AI never writes them: it only gives the numbers of the sentences that tell the news
best, and the code shows those sentences, back in the order of the article. Sentences that follow each other make
one passage; between two passages the card shows "[…]". When the article is in another language than the
reader's, a machine translation is shown, marked as such, with the original one click away.

## Where

- Client: page `client/src/pages/Briefing.jsx` (`BriefingPage`), the chooser "Read as"
  (`client/src/features/briefing/components/BriefingFormat.jsx`, value `'passages'`, the default), the card
  `client/src/features/briefing/components/BriefingCard.jsx` (component `Passages`), the field picked by
  `fieldsOf` of `client/src/features/briefing/formats.js`, the terms followed marked by `paragraphsWithMarks`
  of `client/src/features/briefing/marks.js`.
- API: written by `POST /briefing` (step `summarizing`), read with `GET /briefing` (fields `summary` and
  `translation` of each card), sent with `POST /briefing/:id/email` (`format: 'passages'`), and made for a news
  added by its link (`POST /briefing/:id/news`).

## How it works

- `readStories` (`services/briefing-service.js`) takes, for each story, the first article read whose text has
  60 words or more (`canSummarize`, `MIN_TEXT_WORDS`): under that it is a teaser or a paywall. 5 stories at a
  time (`AI_CONCURRENCY`).
- `sentencesOf` (`services/utils/extract.js`) cuts the page into sentences from its blocks (headings and
  captions never shown, a sentence of a quote marked `quote`), or from its flat text when the blocks hold less
  than half of it. Limits: the first 12 000 characters (`MAX_CONTENT_CHARS`), 80 sentences (`MAX_SENTENCES`),
  4 to 90 words a sentence (`MIN_SENTENCE_WORDS`, `MAX_SENTENCE_WORDS`). Glued sentences ("…les Bleus.Toute")
  are split, abbreviations ("M.", "U.S.") are not an end.
- One call of the AI (`extractPrompt`, `ollamaJson` of `services/utils/ollama.js`): gemma4:31b on Ollama cloud,
  no thinking flag, Gemini (`gemma-4-31b-it`) when Ollama fails. It answers in JSON the numbers of 2 to 5
  sentences, the most important first, the `topic` and the `sourcing` (named, anonymous, none) shown beside the
  card. A quote may only be picked with the sentence that says who said it.
- `buildExtract` keeps the numbers that exist, each once, 5 at most (`MAX_PICKED`), while they fit 170 words
  (`MAX_EXTRACT_WORDS`; the first is always kept), then sets them back in the order of the article and joins
  the ones that follow each other into one passage.
- The same answer makes the two shorter ways of the card, [Summary](../summary/README.md) and
  [Bullet points](../bullet-points/README.md) (`shorterWays`): no other call.
- Translation (`translationFor`): the language of the passages is read by `languageOf`
  (`services/utils/language.js`), the language of the page as fallback. When it is not the reader's, the
  sentences are translated one by one in one call (`translatePassages`); the answer is refused when it does
  not give one translation per sentence or when a translation loses a figure (`keepsFigures`: "1,000" and
  "1 000", "7 p.m." and "19h00" are the same figure). Asked twice at most, then no translation: the reader gets
  the original only.
- No passage at all (a page with no text of its own): the card is unreadable and the next story of the reserve
  takes its place (`readableCards`, `services/utils/readable-cards.js`, 2 more rounds at most). A card whose
  article was read but whose passages the AI failed to choose is kept with `summaryError`.
- `passagesText` writes them as text, one paragraph per passage, a blank line between two, a quote between
  “ ”. They are saved in the card (`summary`, `translation` of `briefings.items`); the search keeps the same
  passages per article (`articles.extract`, `translation`, `translation_language`), the briefing does not read
  that cache.
- After the step, the passages are used again: the review of the cards (`reviewCards`) reads them to leave out
  a card on what the reader refuses, and the [analysis](../analysis-ia/README.md) reads them when the lead
  article was not read whole.
- On the page, `BriefingCard` shows "In the article's words" (or "…, translated" with "Show original"), the
  terms the profile follows marked (`withMarks` on the server, `marks.summary`, `marks.translation`).

Only one way is shown at a time: Key passages, [Summary](../summary/README.md) or
[Bullet points](../bullet-points/README.md), chosen with "Read as" and kept in the browser (`localStorage`,
key `newsgenerator.briefing-format`, `keptFormat` / `keepFormat`). The key passages have no AI version. In the
e-mail, the bar of the cards ticked (`MailBar.jsx`) has its own "In the e-mail, as", preset to the page's way;
`format: 'passages'` (also the default when no format is sent) sends them (`wayOf` of
`services/utils/briefing-mail.js`), "[…]" between two passages. A card listed in `ai` is still sent as
published in this way.

## Measured

- Summaries written by the AI changed what the article says in 4 of 30 articles, 3 of them again in a second
  run; told four rules, 0 of 30 but still minor slips (faithfulness bench, 28.09.2026, comment of `extract.js`).
  Hence sentences picked, never written.
- The AI translation of the briefings: a meaning error in 7 of 309 texts (2.3%), DeepL 28 to 32 of 310 (9.0 to
  10.3%) (`bench/translation-deepl.mjs`, `bench/data/translation-deepl/table.md`, 16.10.2026).

## Diagrams

- [Class diagram](briefing-key-passages-class.png) ([source](briefing-key-passages-class.puml))
- [Sequence diagram](briefing-key-passages-sequence.png) ([source](briefing-key-passages-sequence.puml))
- The whole briefing: [08-briefing](../08-briefing.png), [08b-briefing-cards](../08b-briefing-cards.png),
  [22-briefing-sequence](../22-briefing-sequence.png)

## See also

- [Summary](../summary/README.md) and [Bullet points](../bullet-points/README.md): the shorter ways, of the same sentences
- [Denials](../denials/README.md): asked in the same step, from the same pages
- [Email](../email/README.md): the way the e-mail sends the cards
- [Search > Key passages](../../search/key-passages/README.md): the same passages on the search page, kept per article
