# Briefing > Other angles

Under a card, "Same affair, other angles" lists up to 5 news of the same affair that tell something the
card does not: an earlier or later step, a reaction, a consequence, another party's view, an earlier
stance of one of its actors. They come from any language (the title translated), from the last days, or
from the last 30 days when they name the card's rare names. The AI judges them from their titles only.

## Where

- `client/src/features/briefing/components/BriefingCard.jsx`: `OtherAngles`, under the passages: the
  title (translated, the original shown with "Show original"), its source and language, its day, "told
  by N media".
- In the e-mail, under each card; the reader can take one out in the mail bar (`MailAside.jsx`,
  `removed.angles`).
- API: no route of its own. Written during `POST /api/briefing` (step `angles`), read with
  `GET /api/briefing` as `items[].angles`.

## How it works

- `anglesOf` (`services/briefing-service.js`), in the step `angles`, beside the official sources, the
  names of the cards and what the profile follows; it never fails the briefing.
- The closest stories (`angleCardsOf`): for each card, `StoryModel.closeStories` gives the stories of any
  language of the feeds read since the window of the briefing or 3 days (`ANGLES_DAYS`), the longer, from a
  likeness of 0.6 (`ANGLE_LIKENESS`, pgvector inner product of the centroids), 16 at most, none already on
  a card; 5 cards compared at a time (`ANGLE_QUERIES`).
- The stories of the same names (`services/utils/affair-names.js`, `storiesOfSameNames`): the rare names
  of the card (`mentions.rareNames`: people and bodies, no place, named by 400 news at most and by others
  than the card, 4 per card), a name not yet linked to Wikidata linked now (`exactItems`, 6 per briefing);
  then the stories of the last 30 days (`AFFAIR_DAYS`) naming them or a name of the same item, from 0.45
  to the card (`MentionModel.storiesNaming`), the closest first.
- Per card, 8 closest (`ANGLE_CANDIDATES`), then 5 found by names only (`NAMED_CANDIDATES`), each as its
  newest news of a feed (a news of Google News must be asked for its address), with its day and how many
  media told it.
- With 2 cards or more, `nearCardsOf`: a candidate closer to another card of the briefing than to its own,
  from 0.78 (`CLOSER_CARD_LIKENESS`), brings that card's title to the prompt (3 at most); a candidate
  telling it is "card".
- The AI (`otherAnglesOf`, `anglesPrompt`, gemma4:31b, Gemini when Ollama fails), 5 cards at once: the
  card's title, its other titles (one per language first, 5), its day, and the candidates' titles with
  their day. Each is "same", "angle", "theme", "other" or "card"; only "angle" is kept, and "as" names
  an earlier angle telling the same fact. A card the AI fails on has none.
- `sameFactsOut`: an angle the AI says repeats an earlier one is left out when their likeness is 0.85 or
  more (`SAME_FACT_LIKENESS`). `placeAngles`: 5 shown (`MAX_ANGLES`), the closest first; the first one
  found by names takes the last place when the closest fill them all. A story shown under a card is not
  shown under a later one.
- The titles in another language than the reader's are translated (`translateTexts`). Each angle is saved
  as `{title, titleTranslation, url, source, publishedAt, trusted, language, storyId, media}`.

## Measured

From the comments of `other-angles.js`, `affair-names.js` and `briefing-service.js`:

- 53 cards of two readers (`bench/other-angles*.mjs`, labels by hand): the closest stories alone were an
  angle 46% of the time on football affairs and 10% on opinion pieces on one trend, whatever the threshold
  (63% at best). Judged by the AI from the titles: 47 of the 59 kept were right on the affairs, 21 of 30
  cards got one; 11 kept on 20 cards of trend pieces, none off subject.
- The stance of an actor in the prompt (13.10.2026), 50 cards twice each: right angles 42 and 42 -> 44
  and 43, wrong ones of the trend pieces 10 and 13 -> 8 and 7.
- 5 shown rather than 3 (`bench/angles-places.mjs`, 47 cards of 3 readers, judged twice): right angles
  74 -> 102-103, the same share right (75% -> 72%), the cards with one unchanged (31).
- One fact told in several languages (`bench/angles-dups.mjs`, 47 cards): the AI's "as" and the
  likeness both, from 0.85: 86-90 right angles + 9-10 repeated; the true repeats were 0.82-0.97 apart.
- The other cards named to the AI (`bench/angles-places.mjs`, REJUDGE): briefing 98, the facts of other
  cards shown as angles 5 -> 1, right angles 32 -> 31-32; the 47 cards of briefings 90-92, right angles
  102-103 -> 105-106.
- The names: the Latvian federation backing Infantino a week before it backed Čeferin was 0.60-0.65 from
  that card, when "Čeferin runs again" in 15 languages was 0.80-0.89; of the 21 stories naming "LFF", the
  same fact was 0.91, the stances 0.64-0.65, the Lithuanian ones 0.37-0.58 (13.10.2026).
- Each card compared with 206 000 stories of 3 days: 1.4 s a card (8.10.2026).

## Diagrams

- [Class diagram](briefing-other-angles-class.png) ([source](briefing-other-angles-class.puml))
- [Sequence diagram](briefing-other-angles-sequence.png) ([source](briefing-other-angles-sequence.puml))
- The briefing: [08-briefing](../08-briefing.png), [08b-briefing-cards](../08b-briefing-cards.png),
  [22-briefing-sequence](../22-briefing-sequence.png)

## See also

- [Official source](../official-source/README.md): the other part of the step `angles`
- [Analysis (IA)](../analysis-ia/README.md): cites the angles (`G1`)
- [Email](../email/README.md): the angles kept or taken out in the e-mail
- [Ingestion > Names](../../ingestion/names/README.md): the names the tagger found, read here
- [Ingestion > Stories and threads](../../ingestion/stories-and-threads/README.md): the centroids
