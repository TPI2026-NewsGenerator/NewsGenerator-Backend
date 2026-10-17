# Briefing > Denials

"Contested" on a card: one of its articles reports that someone named denies the news, and the card quotes that
sentence word for word, with the medium and the date, a machine translation under it when it is written in another
language. Nobody is said to be right: the reader is told who denies and where it is written. A card has 2 denials
at most, of two different deniers; most cards have none.

## Where

- Client: `client/src/features/briefing/components/BriefingCard.jsx`, the block `Contested` ("X denies: “…”",
  an "i" saying the sentence is the article's own, found by the AI, and does not say who is right); in the e-mail
  bar, `MailAside.jsx` (the "Edit" panel of `MailBar.jsx`) to take a denial out of the e-mail.
- API: found by `POST /briefing` (step `summarizing`), read with `GET /briefing` (field `contested` of each card,
  with its `marks`), taken out of the e-mail with `removed` of `POST /briefing/:id/email`. The search's key
  passages use the same module (`NewsService.summarizeStories`).

## How it works

- `readStories` (`services/briefing-service.js`) calls `contestedOf(lead title, texts, {language})`
  (`services/utils/contested.js`) for each story, together with the key passages and the AI version, on the pages
  already read (up to 5 articles a story, one per medium). No new page is read.
- For each article, its language is read on its whole text (`languageOf`, one sentence is too short), its
  sentences cut as for the key passages (`sentencesOf` of `extract.js`), and `hasDenial` keeps the ones with a
  word of denial **of that language** (`WORDS`: en "deny", "refute", "dispute", "baseless", "reject … claim";
  fr "dément", "nie", "conteste", "réfute", "sans fondement"; es "niega", "desmiente"; de "bestreitet",
  "weist … zurück"; it "smentisce", "nega"), as whole words even with accents. A language without words of its
  own is read with the English ones; an unknown language with all of them. Each sentence once, 25 at most
  (`MAX_CANDIDATES`), in the order the articles are read.
- No such sentence: no call, no denial. Otherwise one call (`ollamaJson`, gemma4:31b, Gemini when Ollama fails)
  with the card's title and the sentences, each with its medium. For each sentence the AI answers who denies by
  name (`denied_by`), the claim, whether it is about them (`self`), whether it is the card's own news (`about`
  "main" or "side") and whether the sentence reports a denial as a fact ("did not deny", a refusal, an opinion,
  a journalist's analysis are not).
- The code keeps a sentence only when `denial` and `self` are true, `about` is "main" and a name is given, each
  denier once, 2 at most (`MAX_SHOWN`).
- A quote in another language than the reader's is translated (`translateTexts` of `extract.js`, gemma4:31b,
  checked: a translation that loses a figure is left out, and the quote is shown alone).
- A failure (the AI, no JSON) gives no denial, never a failed card. Saved in the card as `contested`:
  `[{by, sentence, translation, language, source, url, publishedAt}]` (`briefings.items`).
- `withMarks` marks the terms the profile follows in each denial (`marks.sentence`, `marks.translation`), and a
  term found only in a denial still counts as found on the card.
- In the e-mail, `MailAside` lists the card's denials, each with a box; the ones unticked go to
  `removed: {storyId: {contested: [index]}}`, and `withoutTakenOut` drops them before `briefingMail` writes
  "Contested" (`contestedHtml`). In the e-mail the translation is shown in place of the original sentence when
  there is one.

The denials do not depend on the way the card is read: they are shown under the key passages, the summary or the
bullet points alike.

## Measured

On the 100 stories of politics and world news and 97 cards of briefings of 2 media or more
(`bench/contested-versions.mjs`, 5.10.2026, comment of `contested.js`): 22 cards would carry it, 21 right (Iran
denying any role in the incident, Bardella's camp contesting the messages, Manchester City denying any wrongdoing),
one sentence of a journalist read as a denial. Comparing what the articles say failed instead: pairs of sentences
40% right, the facts of each article 0 found, "another version" 35% ("47%" and "47.06%", "6-0" and "0-6" given as
two). About 300 tokens a card: the article says the denial itself, the AI only has to read it.

## Diagrams

- [Class diagram](briefing-denials-class.png) ([source](briefing-denials-class.puml))
- [Sequence diagram](briefing-denials-sequence.png) ([source](briefing-denials-sequence.puml))
- The whole briefing: [08-briefing](../08-briefing.png), [08b-briefing-cards](../08b-briefing-cards.png),
  [22-briefing-sequence](../22-briefing-sequence.png)

## See also

- [Key passages](../key-passages/README.md): the same pages, the same sentences, the same step
- [Other angles](../other-angles/README.md) and [Official source](../official-source/README.md): the other asides of a card
- [Email](../email/README.md): the asides taken out of the e-mail
- [Search > Key passages](../../search/key-passages/README.md): denials on the search page
