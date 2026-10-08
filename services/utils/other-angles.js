//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: other-angles.js
//  Description: "Other angles": the news of the same affair as a card that tell something it does not
//               (an earlier or later step, a reaction, another party's view), found among the stories
//               closest to it and told apart by the AI from their titles
//

"use strict"

import {ollamaJson} from './ollama.js';
import {mapWithConcurrency} from './concurrency.js';

// Measured on 53 cards of the briefings of two readers (bench/other-angles*.mjs, labels by hand): the
// closest stories alone were another angle 46% of the time on football affairs and 10% on opinion
// pieces on one trend, whatever the threshold (63% at best). Judged by the AI from the titles, 47 of
// the 59 it kept were right on the affairs (the others mostly the same fact with one more detail),
// 21 of 30 cards got one; 11 kept on 20 cards of the trend pieces, none off subject
export const MAX_ANGLES = 3;            // shown below a card, the closest first
const AI_CONCURRENCY = 5;

// cardTitles: other titles of the card's own articles, other languages first: a title alone often
// leaves out what another tells (the former club of a candidate), and the same fact told with it
// passed for another angle
export const anglesPrompt = (title, others, cardTitles = []) => `A news card: "${title}"${cardTitles.length > 0 ? `
Its own articles also title it: ${cardTitles.map(other => `"${other}"`).join('; ')}` : ''}

Other news published around it:
${others.map((other, i) => `[${i + 1}] ${other.title || '(no title)'}`).join('\n')}

For each one, in any language, what it is to the reader of the card:
"same": it tells the same fact as the card, in other words or another language (a court ruling and
  "the court rules", the same announcement told by another paper), even with a detail the card's titles
  do not give: the age or the former club of the same candidate, a figure or a quote of the same
  announcement, the same deal seen from the other party.
"angle": the same affair, person or event as the card, but it tells something the card does not: an
  earlier or later step, a reaction, a consequence, a background, another party's view. A storm's toll
  for a card on the storm's landfall; a minister's reply for a card on a strike. One person, company or
  body named in both is not enough: an actor's new film is no angle of a card on his hobby, a
  regulator's other case no angle of a card on one of its cases. Two opinion pieces or guides on one
  trend are "theme", whatever they add.
"theme": only the same field or kind of subject (two different product launches, two opinion pieces on
  remote work, two matches of one league).
"other": anything else, or a title too vague to tell.
Answer in JSON only: {"news": [{"n": 1, "kind": "angle"}]}`;

// the others the AI calls an angle, in their order, MAX_ANGLES at most
export const normalizeAngles = (answer, others) => {
    const angles = new Set((Array.isArray(answer?.news) ? answer.news : [])
        .filter(item => item?.kind === 'angle')
        .map(item => Number(item.n) - 1)
        .filter(i => Number.isInteger(i) && i >= 0 && i < others.length));
    return others.filter((other, i) => angles.has(i)).slice(0, MAX_ANGLES);
};

// cards: [{id, title, titles, others: [{title, ...}]}], the others the closest first, titles the
// other ones of the card (see anglesPrompt). Answers a Map id ->
// the others that are angles of its affair; a card the AI failed on has none
export const otherAnglesOf = async (cards, usage = null) => {
    const asked = cards.filter(card => card.others.length > 0);
    const results = await mapWithConcurrency(asked, AI_CONCURRENCY, async (card) =>
        normalizeAngles(await ollamaJson(anglesPrompt(card.title, card.others, card.titles ?? []), usage), card.others));
    const failed = results.filter(result => result.status !== 'fulfilled').length;
    if (failed > 0) console.error(`Briefing: the other angles of ${failed} cards were not judged`);
    return new Map(asked.map((card, i) => [card.id, results[i].status === 'fulfilled' ? results[i].value : []]));
};
