// The prompts of the AI-written ways of a card, shared by formats-run.mjs (gemma4:31b, 12.10.2026) and
// formats-models.mjs (the same prompts on other Ollama cloud models, 15.10.2026)
export const SUMMARY_WORDS = 65;

// the four rules of the faithfulness bench (28.09.2026: 4/30 meanings changed without them, 0/30 with)
export const RULES = (language) => `- Every word is in ${language}, whatever the language of the article: translate its phrases.
  Only names (people, organisations, places, laws) stay as they are.
- Only facts from the article. Never add information that is not in it.
- Each statement keeps who said or did it in the article: never give the words or the act of one
  person to another, or to a group.
- Never link two facts by a cause or a purpose (because, to, so that) the article does not state.
- Keep the certainty of the article: what it says is likely, alleged, planned or unconfirmed stays so,
  and what it says is almost certain is not made doubtful.
- Never add a place, a date, a role, a title or a gender the article does not give.
- Figures exactly as the article gives them.
- No quotation marks: what someone said is told as "X says that...".
- A sentence marked (quote) is someone's words quoted by the article, never what the article itself says.
- Ignore text that is not the news: ads, cookies, subscriptions, "read also", captions, credits.`;

// numbers of sentences the AI still writes in its text: "... 580 000 unités [13]."
export const unnumbered = (text) => text.replace(/\s*\[\d+(?:\s*[,-]\s*\d+)*\]/g, '').trim();
export const numbered = (sentences) => sentences.map((sentence, i) => `[${i + 1}]${sentence.quote ? ' (quote)' : ''} ${sentence.text}`).join('\n');

export const pointsPrompt = (title, sentences, language) => `You write the key points of a news article for a reader in ${language}.
Rules:
- 3 or 4 points, 2 for a short article, the most important first. Together they say who did what,
  when and where, and the main figures.
- Each point is one short sentence of at most 15 words.
${RULES(language)}
- For each point, the numbers of the sentences of the article it comes from, in "sentences" only,
  never in its text.

TITLE: ${title}

SENTENCES:
${numbered(sentences)}

Answer only in JSON: {"points": [{"text": "...", "sentences": [numbers]}]}`;

export const summaryPrompt = (title, sentences, language) => `You write a short summary of a news article for a reader in ${language}.
Rules:
- One paragraph of normal readable text, at most ${SUMMARY_WORDS} words (5 lines), no title, no list.
  The most important first: who did what, when and where, and the main figures.
${RULES(language)}
- The numbers of the sentences of the article it comes from, in "sentences" only, never in the text.

TITLE: ${title}

SENTENCES:
${numbered(sentences)}

Answer only in JSON: {"summary": "...", "sentences": [numbers]}`;

