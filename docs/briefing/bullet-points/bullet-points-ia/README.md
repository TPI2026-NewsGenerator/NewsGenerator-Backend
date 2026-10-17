# Briefing > Bullet points > Bullet points (IA)

The key points of a card written by the AI in the reader's language: 3 or 4 short sentences, for the readers to
compare them with the [Bullet points](../README.md) made of the article's own sentences. They are never shown in
place of them: under the published points, "Show AI version" opens them, marked "Written by the AI" with the model's
name and "it can get a fact wrong. The article's sentences above are the reference."

## Where

- Client: `client/src/features/briefing/components/BriefingCard.jsx`, the button "Show AI version" / "Hide AI
  version" and the component `AiVersion` (a list), only when the card is read as "Bullet points" and has
  `item.ai.points`; in the e-mail bar, `MailBar.jsx` ("Edit", the box "Send its bullet points in the AI version",
  `aiTextOf`).
- API: written by `POST /briefing` (step `summarizing`) and `POST /briefing/:id/news`, read with `GET /briefing`
  (field `ai` of each card: `{points, summary, model}`), sent with `POST /briefing/:id/email` (`format: 'points'`
  and the card's `storyId` in `ai`).

## How it works

- `write` (`services/briefing-service.js`) calls `aiWaysOf(title, page of the lead, {language})`
  (`services/utils/ai-ways.js`) for each card kept, in step "angles" beside the other angles and the official
  sources: not for the stories that ended unreadable or left out by `reviewCards` (asked in `readStories` for
  every story read until 17.10.2026); a failure gives `ai: null`, never a failed card.
- `aiWaysOf` reads the same sentences as the key passages (`sentencesOf` of `extract.js`), numbered, quotes
  marked, and the reader's language by name (`writtenIn`); nothing to write from: `null`.
- Two calls sent together, the points (`pointsPrompt`) and the [summary](../../summary/summary-ia/README.md)
  (`summaryPrompt`), each `ollamaJson(prompt, usage, {model: WRITE_MODEL, think: false})`: `deepseek-v4-pro:0813`
  by default (`OLLAMA_WRITE_MODEL`), thinking off, temperature 0.1, 120 s at most a call.
- The prompt: 3 or 4 points (2 for a short article), the most important first, each one short sentence of at most
  15 words, together who did what, when and where and the main figures; the 10 rules of the faithfulness benches
  (`RULES`: only facts of the article, who said or did what kept, no cause it does not state, its certainty kept,
  figures exactly, every word in the reader's language…); the numbers of the source sentences in `sentences`
  only. It answers `{points: [{text, sentences}]}`.
- The code takes each point's text (a plain string is accepted too), takes out the sentence numbers the AI still
  writes ("[13]", `unnumbered`), drops empty ones and keeps 4 at most (`MAX_POINTS`).
- **Figures check** (`figuresFrom`): every figure of every point must be among the figures of the title and the
  sentences (`figuresOf`). One point with another figure and all the points are left out (`points: null`, a line
  logged): the card keeps its published points.
- No Gemini after this model (it would answer with gemma); Ollama busy (429), the call waits 2, 5, 10, 20, then
  30 s (`OWN_MODEL_WAITS_MS`) and fails after: no AI version.
- Saved in the card, `briefings.items[].ai.points`, with `model`. Briefings written before 15.10.2026 have none.

**Shown on demand.** A card shows one way at a time, chosen with "Read as" and kept in `localStorage`
(`formats.js`, see [Bullet points](../README.md)). The AI version is an extra under it, offered only for
"Bullet points" and "Summary", never for the key passages.

**In the e-mail.** With "In the e-mail, as: Bullet points", the "Edit" panel of a card that has AI points shows the
box "Send its bullet points in the AI version" and, under it, the points the e-mail will send, switched with the
box. The ticked cards go in the `ai` list of `POST /briefing/:id/email` (integers, else 400): `wayOf`
(`services/utils/briefing-mail.js`) sends `card.ai.points` under "Key points", or the published points when the
card has none. The e-mail does not say they are written by the AI (the user, 15.10.2026).

## Measured

On 30 articles, 2 runs each, thinking off (`bench/formats-models.mjs`, `bench/data/faithful/models-table.md`,
15.10.2026): articles whose points had a meaning error, deepseek-v4-pro 1-2, kimi-k3 1-2, gemma4:31b 2-3, the
published sentences 0. deepseek-v4-pro at 4.9 s a call, kimi-k3 9.2 s and three times its cost. No model is free
of errors: hence a version the reader asks for. The decision notes of that day: deepseek-v4-pro's points are
longer (about 50 words against 35 for gemma).

## Diagrams

- [Class diagram](briefing-bullet-points-ia-class.png) ([source](briefing-bullet-points-ia-class.puml))
- [Sequence diagram](briefing-bullet-points-ia-sequence.png) ([source](briefing-bullet-points-ia-sequence.puml))
- The whole briefing: [08-briefing](../../08-briefing.png), [08b-briefing-cards](../../08b-briefing-cards.png),
  [22-briefing-sequence](../../22-briefing-sequence.png)

## See also

- [Bullet points](../README.md): the published version they sit under
- [Summary (IA)](../../summary/summary-ia/README.md): written in the same step, by the same model
- [Analysis (IA)](../../analysis-ia/README.md)
- [Email](../../email/README.md)
