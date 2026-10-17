# Briefing > Summary

A card read in 5 to 6 lines: the most important sentences the AI picked for the [key passages](../key-passages/README.md),
kept while they fit 65 words, shown as one paragraph in the order of the article, "[…]" where sentences were
skipped. Every word is still the article's own; when the article is in another language, the same sentences of the
machine translation are shown. A summary written by the AI exists too, but only as an extra the reader asks for:
see [Summary (IA)](summary-ia/README.md).

## Where

- Client: page `client/src/pages/Briefing.jsx`, the chooser "Read as" (`BriefingFormat.jsx`, value `'digest'`,
  label "Summary"), the card `BriefingCard.jsx` (component `Digest`), `fieldsOf(item, 'digest')` of
  `client/src/features/briefing/formats.js`; in the e-mail bar, `MailBar.jsx` ("In the e-mail, as").
- API: made by `POST /briefing` (step `summarizing`), read with `GET /briefing` (fields `digest`,
  `digestTranslation`, their `marks`), sent with `POST /briefing/:id/email` (`format: 'digest'`).

## How it works

- No call of its own: `extractArticle` (`services/utils/extract.js`) calls `shorterWays(sentences, picked)` with
  the numbers the AI gave for the key passages (gemma4:31b, see [Key passages](../key-passages/README.md)).
- `shorterWays` takes the sentences kept for the key passages (`keptOf`: 5 at most, 170 words), the most
  important first, and keeps them while they fit 65 words (`MAX_DIGEST_WORDS`); the first is always kept, even
  longer. Then `passagesOf` sets them back in the order of the article, joining the ones that follow each other.
- Its translation is not asked again: each sentence takes its translation from the one of the key passages
  (`digestTranslation`, `inReader` in `extractArticle`); none when the passages have none.
- `readStories` (`services/briefing-service.js`) saves it in the card as text (`passagesText`): `digest`,
  `digestTranslation` of `briefings.items`. A card added by its link gets it the same way (`importedCard`).
- `withMarks` marks the terms the profile follows in it (`marks.digest`, `marks.digestTranslation`).
- The [official source](../official-source/README.md) step reads the digest of each card (700 characters at
  most, `OFFICIAL_TEXT`) as what the card says.
- On the page, `BriefingCard` shows the `Digest` component: one paragraph, " […] " between the passages. A
  briefing written before 12.10.2026 has no digest: `fieldsOf` falls back to the key passages and the page shows
  no chooser ("Bullet points and a short summary come with your next briefing").

**Chosen by the reader.** One way is shown at a time: [Key passages](../key-passages/README.md) (the default),
Summary or [Bullet points](../bullet-points/README.md), with "Read as" above the cards. The choice is kept in the
browser (`keepFormat`, `localStorage` key `newsgenerator.briefing-format`) and read back by `keptFormat` at the
next visit. Under the summary, "Show AI version" opens the [Summary (IA)](summary-ia/README.md) when the card
has one: an extra on demand, never in place of the published sentences.

**In the e-mail.** The bar of the cards ticked has its own chooser, preset to the page's way. `format: 'digest'`
of `POST /briefing/:id/email` (one of `MAIL_FORMATS`, else 400) makes `wayOf` of `services/utils/briefing-mail.js`
send `digestTranslation`, else `digest`, as one paragraph titled "Summary" (" […] " in the text version). A card
without a digest is sent with its key passages. The `ai` list of the body (the `storyId`s whose box "Send its
summary in the AI version" was ticked in the bar) sends the AI summary instead, for those cards only.

## Measured

On 30 articles (`bench/formats-run.mjs`, `bench/formats-pieces.mjs`, 12.10.2026, comment of `shorterWays`):
summaries and points written by the AI changed the meaning of 2 or 3 articles, pieces cut out of sentences 1 to 3,
whole published sentences none. The decision notes of that day: the published summary about 5.4 lines, a sentence
out of context sometimes lacks its subject (14 of 28 with a "he", "this" left unclear).

## Diagrams

- [Class diagram](briefing-summary-class.png) ([source](briefing-summary-class.puml))
- [Sequence diagram](briefing-summary-sequence.png) ([source](briefing-summary-sequence.puml))
- The whole briefing: [08-briefing](../08-briefing.png), [08b-briefing-cards](../08b-briefing-cards.png),
  [22-briefing-sequence](../22-briefing-sequence.png)

## See also

- [Summary (IA)](summary-ia/README.md): the same way written by the AI, on demand
- [Key passages](../key-passages/README.md): the sentences it is made of
- [Bullet points](../bullet-points/README.md): the other shorter way
- [Email](../email/README.md)
