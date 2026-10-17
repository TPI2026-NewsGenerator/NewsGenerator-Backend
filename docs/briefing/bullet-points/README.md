# Briefing > Bullet points

A card read as a list: the 3 most important sentences the AI picked for the [key passages](../key-passages/README.md),
one sentence a point, the most important first. Every word is the article's own; when the article is in another
language, the same sentences of the machine translation are shown. Points written by the AI exist too, but only as
an extra the reader asks for: see [Bullet points (IA)](bullet-points-ia/README.md).

## Where

- Client: page `client/src/pages/Briefing.jsx`, the chooser "Read as" (`BriefingFormat.jsx`, value `'points'`,
  label "Bullet points"), the card `BriefingCard.jsx` (component `Points`, a `<ul>`), `fieldsOf(item, 'points')` of
  `client/src/features/briefing/formats.js`; in the e-mail bar, `MailBar.jsx` ("In the e-mail, as").
- API: made by `POST /briefing` (step `summarizing`), read with `GET /briefing` (fields `points`,
  `pointsTranslation`, their `marks`), sent with `POST /briefing/:id/email` (`format: 'points'`).

## How it works

- No call of its own: `extractArticle` (`services/utils/extract.js`) calls `shorterWays(sentences, picked)` with
  the numbers the AI gave for the key passages (gemma4:31b, see [Key passages](../key-passages/README.md)).
- `shorterWays` takes the sentences kept for the key passages (`keptOf`: the numbers that exist, each once, 5 at
  most, 170 words), in the order of importance the AI gave, and keeps the first 3 (`MAX_POINTS`), each a passage
  of its own: unlike the key passages and the summary, they are not set back in the order of the article.
- Their translation is not asked again: each point takes the translation of its sentence from the one of the key
  passages (`pointsTranslation`); none when the passages have none.
- `readStories` (`services/briefing-service.js`) saves them in the card as text (`passagesText`, a blank line
  between two points): `points`, `pointsTranslation` of `briefings.items`. A card added by its link gets them the
  same way (`importedCard`). `withMarks` marks the terms the profile follows in them.
- On the page, `BriefingCard` splits the text in paragraphs (`paragraphsWithMarks` of `marks.js`) and shows one
  bullet each. A briefing written before 12.10.2026 has no points: `fieldsOf` falls back to the key passages and
  the page shows no chooser.

**Chosen by the reader.** One way is shown at a time: [Key passages](../key-passages/README.md) (the default),
[Summary](../summary/README.md) or Bullet points, with "Read as" above the cards (`BriefingFormat`, a radix
`ToggleGroup`, one always chosen). The choice is kept in the browser (`keepFormat`, `localStorage` key
`newsgenerator.briefing-format`) and read back by `keptFormat` at the next visit, `'passages'` when nothing valid
is kept. Under the points, "Show AI version" opens the [Bullet points (IA)](bullet-points-ia/README.md) when
the card has them: an extra on demand.

**In the e-mail.** The bar of the cards ticked has its own "In the e-mail, as", preset to the page's way and
hidden for a briefing without the shorter ways. `format: 'points'` of `POST /briefing/:id/email` (one of
`MAIL_FORMATS`, else 400) makes `wayOf` of `services/utils/briefing-mail.js` send `pointsTranslation`, else
`points`, as a list titled "Key points" (`pointsHtml`; "• " before each in the text version). A card without
points is sent with its key passages. The cards of the `ai` list of the body are sent with their AI points
instead.

## Measured

On 30 articles (`bench/formats-run.mjs`, `bench/formats-pieces.mjs`, 12.10.2026, comment of `shorterWays`):
points and summaries written by the AI changed the meaning of 2 or 3 articles, pieces cut out of sentences 1 to 3,
whole published sentences none. The decision notes of that day: the published points are not condensed (69 words,
7.7 lines on average, 16 at most), and 18 of 28 had a "he", "this" whose subject is in a sentence left out.

## Diagrams

- [Class diagram](briefing-bullet-points-class.png) ([source](briefing-bullet-points-class.puml))
- [Sequence diagram](briefing-bullet-points-sequence.png) ([source](briefing-bullet-points-sequence.puml))
- The whole briefing: [08-briefing](../08-briefing.png), [08b-briefing-cards](../08b-briefing-cards.png),
  [22-briefing-sequence](../22-briefing-sequence.png)

## See also

- [Bullet points (IA)](bullet-points-ia/README.md): the same way written by the AI, on demand
- [Key passages](../key-passages/README.md): the sentences they are taken from
- [Summary](../summary/README.md): the other shorter way
- [Email](../email/README.md)
