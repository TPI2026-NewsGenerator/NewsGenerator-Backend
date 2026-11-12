# Briefing > Analysis (IA)

A minute or more after the cards are shown, some of them get a short analysis written by the AI: why the
news matters, what could come next ("If ..., then ..."), and the story so far, the earlier news of its
affair. Only the cards that merit one get it (an affair, a dispute, stakes the title does not tell, a step
to come); a match result or a routine appointment gets none. Each line rests on the card's own sources,
and the code drops a line whose figure or name those sources do not give.

## Where

- Page `client/src/pages/Briefing.jsx`: asks `GET /api/briefing` again every 8 s (`ANALYSIS_POLL_MS`)
  while `analysis.status` is `running`, and takes only the analysis from the answer.
- `client/src/features/briefing/components/BriefingAnalysis.jsx`: `AnalysisNote` on top of the cards
  ("The AI is choosing...", then the numbers of the cards being written, then the ones that have one),
  `CardAnalysis` under the passages of a card ("AI analysis being prepared…", then "Show the AI
  analysis"), opened from `BriefingCard.jsx`.
- API: no route of its own. It is written at the end of `POST /api/briefing` and read with the briefing,
  `GET /api/briefing` (`briefings.analysis`, jsonb, `db/add_briefing_analysis.sql`).

## How it works

- At the end of `write()` (`services/briefing-service.js`), `analysisArticles` gives each card its lead
  and one article of each other medium, read whole (3 sentences at least); a lead not read whole stands as
  its key passages. `fittedArticles` (`services/utils/card-analysis.js`) keeps 5 articles and 12 000
  characters, the lead 6 000 at least, 3 000 at most of each other one.
- `analyze()` runs without being awaited: `briefings.analysis` is saved `{status: 'running', model,
  startedAt}` at once. `cardAnalyses` takes the cards with passages and articles, and the earlier stories
  of each card's thread (`StoryModel.earlierInThreads`): its own stories and links left out, a title once,
  12 at most (`TIMELINE_MAX`), the oldest first, their titles translated (`translateTexts`, 25 a call).
- The triage, `pickedCards`: one call of `deepseek-v4-pro:0813` (`ANALYSIS_MODEL`, `OLLAMA_ANALYSIS_MODEL`),
  thinking off, reads each card's title, medium, 1 600 characters of passages and whether earlier stories
  exist. No limit of cards (the user, 15.10.2026). The cards picked are saved at once (`onPicked`), so the
  page can say which ones are coming; and each card done, written or not, saves the time it was done as
  `beatAt` (`onCard`), so a long analysis is never taken for one abandoned.
- The analysis, `analysisOfCard`: the same model, thinking on, 300 s at most a call, 3 cards at once
  (`CARDS_AT_ONCE`; Ollama cloud takes 6 calls at once for the key). Its sources are numbered: `A1 s12`
  (article 1, sentence 12), `T3` (earlier story), `G2` (other angle), `D1` (denial), `O1` (official
  source). The prompt asks who says what, no link of cause the sources do not make, the certainty of the
  sources kept.
- `checkedLines`, no AI: 2 "why" and 2 "next" kept at most; the ids still in the text are taken out
  ("A1" becomes the medium); a line is dropped when it cites no source of the card, or when one of its
  figures or names is in none of its cited sources (a cited sentence counts with its whole article). The
  names are read by the NER tagger (`tagger.js`, the first of `NER_URL` that answers); with none, the
  words in capitals stand for the names. One missing name found elsewhere in the card passes. A "why" line of 8
  words or more whose words (4 letters or more) are 75% or more in the card's title and key passages is
  dropped too (`repeatsCard`, 2.11.2026): it says again what the reader sees. Measured on the 312 "why" lines
  judged blind, 6 lines so, 5 of them judged no use and none useful; at 70% it dropped 2 useful lines of 13.
- Saved `{status: 'ready', model, picked, dropped, cards: {storyId: {why, next, timeline}}}`. A card the
  AI fails on, or whose lines are all dropped, has none. A call of this model never goes to Gemini
  (`ollama.js`): when it fails it goes to `gemma4:31b` (`FALLBACK_MODEL`, `OLLAMA_FALLBACK_MODEL`; `gpt-oss:120b` from 8.11.2026 to 9.11.2026), the analysis
  then says "deepseek-v4-pro + gemma4" (`usage.models`); a failure of both is no analysis. An error of the whole run saves `{status: 'failed'}`.
- An analysis still `running` with no card done for 12 minutes (`ANALYSIS_ABANDONED_MS`, counted from
  `beatAt`, else from `startedAt`: a server that stopped) is answered `failed` (`analysisOfRow`). Counted from
  its start until 17.10.2026, a long one (cards of up to 300 s each and their busy waits, 3 at a time, no
  limit of cards) was said failed while it ran, and the page stopped asking for it until a reload.
- "The story so far" holds the earlier stories of the thread of the card (`StoryModel.earlierInThreads`), the ones **created before the card's own story**:
  until 10.11.2026 it was before the hour of the briefing, so a story of the same affair created the same day as the card, or after it (the
  complaint of the AESAF of 10 Nov, told as it was for a card of 9 Nov), stood in its history. 35 of the 157 lines of 12 briefings (22 %), on 27
  of the 70 cards that had a history, were not earlier than their card. Such a story is not history: it tells the same news (then it is among the media
  that tell it) or another fact of the moment (then it is among the other angles: the two lists are not the same thing, the history is what came
  before).
- **Only the lines of its own affair** (`timeline-relevance.js`, 12.11.2026). A thread gathers the stories that *look alike* (0.75 on average), so
  the card of the FKF of Kenya asking a FIFA normalisation committee had six lines of the NFF of Nigeria asking one (a friend of the user): a line
  of another country's own dispute, the other sports of the same Games, or another match of the same league. One AI call a card that has an
  analysis (about 450 tokens) reads the titles of the newest 24 lines against the card and keeps the ones of the same affair (the same parties:
  earlier steps, causes, the other candidates of one election); 12 at most are shown, and the same lines go to the analysis (`T1`...). An AI that
  fails or answers no list leaves the lines as they were. Measured by hand on 166 lines: 96% of the lines kept right, about 11% of the right ones lost
  (the sagas); a rule by countries and the likeness of the stories were measured and rejected (see [Quality](../../quality/README.md)).
  `bench/timeline-so-far/` holds the measures, `live-timelinerelated-*` the three live cases.
- The e-mail carries the analysis of each card sent, the lines the reader kept (see `../email/README.md`).

## Measured

On the 139 cards of 10 briefings of 7 profiles (`bench/card-analysis-*.mjs`, 15.10.2026), every line
judged blind, then read again (comments of `card-analysis.js`, [the former README](../../archive/readme-features-2026-10-24.md) "The briefing"):

- Triage, deepseek-v4-pro without reasoning: 1 to 4 plain news picked of about 50, 7-8 of 51 that merit
  one missed; about 5 s. gemma4:31b picked 7 plain news.
- Analysis, deepseek-v4-pro with reasoning and the rules of who says what: a misleading line on 4-5 of
  74 cards; the same rules without reasoning 20, the first rules with reasoning 20-30, gemma4:31b 29.
  70-78% of the lines worth showing. 71 s a card, up to 161 s. No outside knowledge found in any run.
- The rules (who says what, no link of cause, 2 "why" at most): a misleading line on 41% of the cards
  before them, 5-7% after.
- The checks of the code catch few of the misleading lines (they slip on who says what or on certainty)
  and drop some right ones: 5 of the 12 drops of round 2 were translated names.
- About $0.015 a card of the prepaid credits of Ollama; a briefing of 25 cards of affairs had 12 picked.

## Diagrams

- [Class diagram](briefing-analysis-ia-class.png) ([source](briefing-analysis-ia-class.puml))
- [Sequence diagram](briefing-analysis-ia-sequence.png) ([source](briefing-analysis-ia-sequence.puml))
- The briefing: [08-briefing](../08-briefing.png), [08b-briefing-cards](../08b-briefing-cards.png),
  [22-briefing-sequence](../22-briefing-sequence.png)

## See also

- [Key passages](../key-passages/README.md): the passages the analysis does not repeat
- [Other angles](../other-angles/README.md), [Denials](../denials/README.md),
  [Official source](../official-source/README.md): the sources `G`, `D` and `O` it cites
- [Email](../email/README.md): the analysis lines kept or taken out in the e-mail
- [Ingestion > Stories and threads](../../ingestion/stories-and-threads/README.md): the threads of
  the timeline
