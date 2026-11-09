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
  are split, abbreviations ("M.", "U.S.") are not an end. A dash or a bullet opening a sentence is left out: the
  dateline "Zurich, 27 October 2026 —- The IFAB's..." showed as a point "—- The IFAB's..." (28.10.2026). The datelines of the
  agencies go too: "WASHINGTON (Reuters) -", "LONDON, Nov 6 (Reuters) -", "(CNN) —", "(GLO)-", and the city of a wire in capitals and a
  colon, "ZURICH: …", "DAR ES SALAAM: …", or a credit ("HIBAPRESS: …") (`withoutDateline`, 9.11.2026; 11 such starts in the 154 briefings
  saved, no other; a token of fewer than 4 letters and the bodies of `SUBJECTS` — "VAR: …", "FIFA: …" — are subjects and stay). The caption of
  a photo, "EAST RUTHERFORD, NEW JERSEY - JULY 19: …", is **left out of the sentences** altogether (`isPhotoCaption`): it was the first key
  point of a card, and is not a sentence of the article. Measured on the 709 cards of 14 days: no key point began with a time, a date or a
  tag in brackets after the datelines above.
- One call of the AI (`extractPrompt`, `ollamaJson` of `services/utils/ollama.js`): gemma4:31b on Ollama cloud,
  no thinking flag, Gemini (`gemma-4-31b-it`) when Ollama fails. It answers in JSON the numbers of 2 to 5
  sentences, the most important first, the `topic` and the `sourcing` (named, anonymous, none) shown beside the
  card. A quote may only be picked with the sentence that says who said it.
- `buildExtract` keeps the numbers that exist, each once, 5 at most (`MAX_PICKED`), while they fit 170 words
  (`MAX_EXTRACT_WORDS`; the first is always kept), then sets them back in the order of the article and joins
  the ones that follow each other into one passage.
- The same answer makes the two shorter ways of the card, [Summary](../summary/README.md) and
  [Bullet points](../bullet-points/README.md) (`shorterWays`): no other call.
- Translation (`translationFor`): the language of the passages is read by `ownLanguage`
  (`services/utils/language.js`): **from its own letters first** (`scriptLanguage`: Persian, Arabic, Cyrillic, Armenian, Greek,
  Chinese... whatever the label of the feed or the language of the page read, since 9.11.2026: Persian news of an English feed
  were labelled English and shown untranslated, their titles too), then the short words and the groups of letters, the language
  of the page as fallback. The same rule gives the label of a news at the ingestion (`languageOf`) and the language of each
  article of a story chosen (`readStories`, before it picks the article to read). When it is not the reader's, the
  sentences are translated one by one in one call (`translatePassages`); the answer is refused when it does
  not give one translation per sentence or when a translation loses a figure (`keepsFigures`: "1,000" and
  "1 000", "7 p.m." and "19h00" are the same figure; since 8.11.2026 a unit of number is read too: the Korean, Chinese and
  Japanese "2만" / "2万" is 20,000, "1억" 100 million, "12만 5천" 125,000, and "2 million" and "2 000 000" are one, see
  `figureEntries`: a Korean sentence with "2만" was refused for a figure lost and left in Korean). Asked three times at most.
  A sentence the AI translated but whose figures the check could not match is **shown translated, in italics, with a ⚠**
  after it in a briefing (`UNCHECKED` of `original-marks.js`, since 8.11.2026, the user: a sentence should always be
  translated; the card says what ⚠ means); a page that cannot warn (the search) leaves it in its language between
  parentheses, in italics in a briefing, as before, and so does a sentence the AI did not translate at all. No translation
  (the reader gets the original only) when the AI does not answer one per sentence, or for half of the sentences that have none.
- A translation is not lost to the AI failing (9.11.2026, `translationWaits` of `extract.js`): a call that fails (Ollama busy over its
  6 places, no answer, no JSON) is asked again after 3 s then 8 s; an answer with another number of translations than the sentences
  (or titles) asked, or an answer that is no JSON (gemma wrote "[1] …" in the array of a list of 15 titles), is followed by the same texts **one at a time**, as the same list asked again came back as short; in a briefing a card
  still without its translation is asked again as a whole after 4 s then 12 s (not in the search, which answers a reader waiting). When the
  AI does not answer at all the asking stops. A card of another language still without its translation after all this is **left out and
  its place taken by the next story of the reserve** (`dropUntranslated` of `readStories`, `readableCards`), never shown half done; a
  news the reader adds by its link is kept as it is. The failures are in the server log ("Translation: …", `translationStats`).
- The same for the **titles** (`translateTextsSure`, 9.11.2026): a title that came back without its translation is asked once more after a
  pause (4 s); a card whose title is still in another language than the reader's is **left out and replaced by the next story of the
  reserve**, like one whose passages could not be translated (`completeCards`, "its title could not be translated" in the log; a news the
  reader added keeps it); an **other angle** whose title could not be translated is not shown (`anglesOf`, `failedTitle` of
  `title-translation.js`, which the titles of the affairs and of their timelines use too). Not covered: a title in Latin letters under the
  label of the language of the reader (a Spanish title of a feed declared English with no clear short words): only its script is read.
- What a reader sees is checked by its letters, not by the label: `bench/translation-completeness.mjs [days]` reads the saved
  briefings text by text (title, passages, key points, digest, angles) against the reader's language, and `scripts/briefing-audit.js`
  has the same check ("no text a reader sees is written in another language than theirs", `shownLanguage`). On the 33 briefings of
  the 14 days before 9.11.2026: 16 had a text in another language (12 once the false alarms of the short words were removed), with the
  Persian family (label English, 5 titles and 2 passages in the 3 last days), cards translated before the figure checks of 30.10 and
  8.11.2026 (figure lost, "1/8-finals" and dates), and calls that failed once.
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
key `newsgenerator.briefing-format`, `keptFormat` / `keepFormat`) and on the account ([Preferences](../../accounts/preferences/README.md)). The key passages have no AI version. In the
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
