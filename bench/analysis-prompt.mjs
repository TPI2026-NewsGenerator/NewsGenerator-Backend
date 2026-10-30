// The prompt of the analysis bench (analysis-run.mjs): one call per briefing, its cards only.
import {writtenIn} from '../services/utils/language.js';

const LINE_PASSAGES = 1600;

// a card as the AI reads it: what the reader sees of it, the passages in the reader's language when
// the reader has a translation of them
export const cardText = (card) => {
    const passages = (card.translation ?? card.passages).replace(/\n{2,}/g, '\n').slice(0, LINE_PASSAGES);
    return `[${card.n}] ${card.medium ?? 'unknown medium'}
Title: ${card.title}${card.titleTranslation ? `\nTitle translated: ${card.titleTranslation}` : ''}
Key passages${card.translation ? ' (translated)' : ''}:
${passages}`;
};

export const analysisPrompt = (briefing) => {
    const language = writtenIn(briefing.language) ?? 'English';
    return `You write the opening analysis of a news briefing for one reader, in ${language}. You only have the
cards below: each is one news story, given by its number, its medium, its title and its key passages
(sentences copied from the article). You know nothing else: no background knowledge, no other news,
no guess.

Write three parts:

1. "changed": one line per card, in the order of the cards: the main new fact of that card in one
   sentence of at most 25 words: who did what, with the figure or date that matters when the card
   gives one. Tell something the title alone does not tell when the passages allow it. It cites its
   card.

2. "system": what links several cards: a common actor, decision, cause or trend that at least 3
   cards show together, and why it matters. Only a link the cards themselves show (the same actor,
   the same decision, one fact causing or answering another), never a theme as broad as "football"
   or "technology". Briefings mixing different interests often have none: then answer an empty
   list. An empty list is a good answer; a forced link is a wrong one. At most 2 entries of 1-2
   sentences, each citing all the cards it relies on (3 or more).

3. "risks": what could happen next, as "If X, then Y", 0 to 3 entries. Both X and Y must be stated
   by the cited cards: a pending decision, a deadline, an announced vote or ruling, a threat, a
   warning, or a consequence someone in the card names. Never a consequence you imagine yourself,
   never an event, actor or place no cited card names. No such risk in the cards: an empty list.

For every line:
- every name (person, organisation, place, product), every figure and every date is in the cards it
  cites (a name may be translated);
- the certainty of the cards is kept: what is planned, alleged, likely, demanded or a rumour stays
  so, and what someone says stays said by them;
- no opinion and no advice of your own;
- the card numbers go in "cards" only, never in the text.

CARDS

${briefing.cards.map(cardText).join('\n\n')}

Answer only in JSON, all text in ${language}:
{"changed": [{"cards": [1], "text": "..."}], "system": [{"cards": [2, 5, 7], "text": "..."}], "risks": [{"cards": [3], "if": "...", "then": "..."}]}`;
};
