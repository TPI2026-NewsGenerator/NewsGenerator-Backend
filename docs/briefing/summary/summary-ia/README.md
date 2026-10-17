# Briefing > Summary > Summary (IA)

The summary of a card written by the AI in the reader's language, for the readers to compare it with the
[Summary](../README.md) made of the article's own sentences. It is never shown in place of them: under the
published sentences, "Show AI version" opens it, marked "Written by the AI" with the model's name and "it can get a
fact wrong. The article's sentences above are the reference."

## Where

- Client: `client/src/features/briefing/components/BriefingCard.jsx`, the button "Show AI version" / "Hide AI
  version" and the component `AiVersion`, only when the card is read as "Summary" and has `item.ai.summary`; in
  the e-mail bar, `MailBar.jsx` ("Edit", the box "Send its summary in the AI version", `aiTextOf`).
- API: written by `POST /briefing` (step `summarizing`) and `POST /briefing/:id/news` (a news added by its link),
  read with `GET /briefing` (field `ai` of each card: `{points, summary, model}`), sent with
  `POST /briefing/:id/email` (`format: 'digest'` and the card's `storyId` in `ai`).

## How it works

- `write` (`services/briefing-service.js`) calls `aiWaysOf(title, page of the lead, {language})`
  (`services/utils/ai-ways.js`) for each card kept, in step "angles" beside the other angles and the official
  sources: not for the stories that ended unreadable or left out by `reviewCards` (asked in `readStories` for
  every story read until 17.10.2026). A failure gives `ai: null`, never a failed card.
- `aiWaysOf` reads the same sentences as the key passages (`sentencesOf` of `extract.js`), numbered, quotes
  marked, and the reader's language by name (`writtenIn`). No sentence or a language it cannot name: `null`.
- Two calls sent together, the summary (`summaryPrompt`) and the [points](../../bullet-points/bullet-points-ia/README.md)
  (`pointsPrompt`), with `ollamaJson(prompt, usage, {model: WRITE_MODEL, think: false})`:
  `WRITE_MODEL` is `OLLAMA_WRITE_MODEL`, `deepseek-v4-pro:0813` by default, thinking off (the model reasons by
  default otherwise), temperature 0.1, 120 s at most a call.
- The prompt: one paragraph of normal text, at most 65 words (`SUMMARY_WORDS`), the most important first, and
  the 10 rules of the faithfulness benches (`RULES`): every word in the reader's language, only facts of the
  article, who said or did what kept, no cause or purpose it does not state, its certainty kept, no place, date,
  role, title or gender added, figures exactly, no quotation marks, a quote never told as the article's own
  words, no ads or captions. It answers `{summary, sentences}`.
- `unnumbered` takes out the sentence numbers the AI still writes in its text ("… 580 000 unités [13]."), about 1
  answer in 30.
- **Figures check** (`figuresFrom`): every figure of the summary must be among the figures of the title and the
  sentences (`figuresOf`, the same reading as the translation check of `extract.js`). Otherwise the summary is
  left out (`summary: null`) and a line is logged; the card keeps its published summary.
- No Gemini after this model: Gemini would answer with gemma. Ollama busy (429), the call waits 2, 5, 10, 20 then
  30 s (`OWN_MODEL_WAITS_MS`) and fails after; the card then has no AI version.
- Saved in the card (`briefings.items[].ai`, with `model`). The briefings written before 15.10.2026 have none: no
  button.

**Shown on demand.** A card shows one way at a time, chosen with "Read as" and kept in `localStorage`
(`formats.js`, see [Summary](../README.md)). The AI version is an extra under it: `BriefingCard` only offers it for
the ways "Summary" and "Bullet points", never for the key passages.

**In the e-mail.** With "In the e-mail, as: Summary", the "Edit" panel of a card that has an AI summary shows the
box "Send its summary in the AI version" and, under it, the exact text the e-mail will send. The ticked cards go in
the `ai` list of `POST /briefing/:id/email` (integers, else 400). `BriefingService.email` marks them `aiVersion`,
and `wayOf` (`services/utils/briefing-mail.js`) sends `card.ai.summary` under the title "Summary", or the
published summary when the card has none. The e-mail does not say the text is written by the AI (the user,
15.10.2026).

## Measured

On 30 articles, 2 runs each, thinking off (`bench/formats-models.mjs`, `bench/data/faithful/models-table.md`,
15.10.2026): articles whose summary had a meaning error, deepseek-v4-pro 2, kimi-k3 2-3, gemma4:31b 2, the
published sentences 0. deepseek-v4-pro wrote the clearest (3 unclear references in its summaries, gemma 12), 4.9 s
a call; kimi-k3 alike at 9.2 s and three times its cost. No model is free of errors: hence a version the reader
asks for. The decision notes give its cost at about 11 times gemma's per briefing.

## Diagrams

- [Class diagram](briefing-summary-ia-class.png) ([source](briefing-summary-ia-class.puml))
- [Sequence diagram](briefing-summary-ia-sequence.png) ([source](briefing-summary-ia-sequence.puml))
- The whole briefing: [08-briefing](../../08-briefing.png), [08b-briefing-cards](../../08b-briefing-cards.png),
  [22-briefing-sequence](../../22-briefing-sequence.png)

## See also

- [Summary](../README.md): the published version it sits under
- [Bullet points (IA)](../../bullet-points/bullet-points-ia/README.md): written in the same step, by the same model
- [Analysis (IA)](../../analysis-ia/README.md): the other text of the card written by deepseek-v4-pro
- [Email](../../email/README.md)
