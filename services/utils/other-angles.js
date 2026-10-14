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
// 21 of 30 cards got one; 11 kept on 20 cards of the trend pieces, none off subject. The stance of an
// actor added 13.10.2026: the Latvian federation backing Infantino a week before backing Čeferin was
// "theme" 5 times of 6, "angle" 3 of 3 with it; on the 50 cards, twice each, right angles 42 and 42 ->
// 44 and 43, wrong ones of the trend pieces 10 and 13 -> 8 and 7, of the affairs 10 and 9 both
// Shown below a card, the closest first. 5 rather than 3 (bench/angles-places.mjs, the 47 cards of 3
// readers' last briefings judged twice, labels by hand): right angles 74 -> 102-103, the same share
// right (75% -> 72%), the cards with one unchanged (31). The place of an angle found by names (see
// placeAngles) costs nothing at 5; at 3 it took the place of 1 to 3 right ones
export const MAX_ANGLES = 5;
const AI_CONCURRENCY = 5;

// the day of a news as the AI reads it, "30 Sep", '' without one
export const dayOf = (at) => {
    const date = at ? new Date(at) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('en-GB', {day: 'numeric', month: 'short', timeZone: 'Europe/Zurich'}) : '';
};
const dated = (at) => dayOf(at) ? `(${dayOf(at)}) ` : '';

// cardTitles: other titles of the card's own articles, other languages first: a title alone often
// leaves out what another tells (the former club of a candidate), and the same fact told with it
// passed for another angle. Each news with its day: the ones naming the card's actors go weeks back
// (see affair-names.js), an earlier step is told by its date. at: the card's day. otherCards: the
// titles of the other cards of the briefing some of these news are closer to (see nearCardsOf): a
// news telling one of them is "card", left out like "same"
export const anglesPrompt = (title, others, cardTitles = [], at = null, otherCards = []) => `A news card${dayOf(at) ? ` of ${dayOf(at)}` : ''}: "${title}"${cardTitles.length > 0 ? `
Its own articles also title it: ${cardTitles.map(other => `"${other}"`).join('; ')}` : ''}${otherCards.length > 0 ? `
The same briefing has other cards, each its own news: ${otherCards.map(other => `"${other}"`).join('; ')}` : ''}

Other news published around it:
${others.map((other, i) => `[${i + 1}] ${dated(other.at)}${other.title || '(no title)'}`).join('\n')}

For each one, in any language, what it is to the reader of the card:
"same": it tells the same fact as the card, in other words or another language (a court ruling and
  "the court rules", the same announcement told by another paper), even with a detail the card's titles
  do not give: the age or the former club of the same candidate, a figure or a quote of the same
  announcement, the same deal seen from the other party.
"angle": the same affair, person or event as the card, but it tells something the card does not: an
  earlier or later step, a reaction, a consequence, a background, another party's view, an earlier or
  later stance of one of its actors on the same election, vote or dispute, even weeks apart (a body
  backing one side, then the other). A storm's toll for a card on the storm's landfall; a minister's reply for a card on a strike. One person, company or
  body named in both is not enough: an actor's new film is no angle of a card on his hobby, a
  regulator's other case no angle of a card on one of its cases. Two opinion pieces or guides on one
  trend are "theme", whatever they add. For a card on a dispute, a decision or a sanction around a
  game, the ordinary news of the game are "theme": its preview, report, score, line-ups, ratings or
  injuries, and the other games of its teams. What tells that dispute is an angle: the incident it is
  about, a reaction to the decision, the sanction.
"theme": only the same field or kind of subject (two different product launches, two opinion pieces on
  remote work, two matches of one league).
"other": anything else, or a title too vague to tell.${otherCards.length > 0 ? `
"card": it tells the news of one of the other cards of the briefing, in any language.` : ''}
An "angle" telling the same fact as an earlier "angle" of this list (the same step, reaction or
statement told by another paper or in another language) gets that one's number as "as".
Answer in JSON only: {"news": [{"n": 1, "kind": "angle"}, {"n": 2, "kind": "angle", "as": 1}]}`;

// the others the AI calls an angle, in their order (see placeAngles for the ones shown). One it says
// tells the same fact as an earlier angle ("as") carries that one's story id as sameAs (see sameFactsOut)
export const normalizeAngles = (answer, others) => {
    const items = (Array.isArray(answer?.news) ? answer.news : []).filter(item => item?.kind === 'angle');
    const index = (n) => Number(n) - 1;
    const valid = (i) => Number.isInteger(i) && i >= 0 && i < others.length;
    const angles = new Set(items.map(item => index(item.n)).filter(valid));
    const sameAs = new Map(items.filter(item => angles.has(index(item.as)) && index(item.as) < index(item.n))
        .map(item => [index(item.n), others[index(item.as)].storyId]));
    return others.flatMap((other, i) => !angles.has(i) ? [] : sameAs.has(i) ? [{...other, sameAs: sameAs.get(i)}] : [other]);
};

// Below one card, the FIFA's denial of a second salary for Infantino told in 4 languages took 4 of its 5
// angles (14.10.2026). Measured on the 47 cards of Enzo's three profiles (bench/angles-dups.mjs, the
// same 3 answers of the AI counted each way, labels by hand): right angles of 88-91 facts + 14 repeated
// without; the AI's "as" alone 80-86 + 5, as it also joins two steps of one affair (a suspension and
// its softening); the likeness alone 72 + 11 at 0.90, 42 + 0 at 0.70 (every angle of one affair is
// close); both: 84-89 + 7 from 0.80, 86-90 + 9-10 from 0.85 (the true repeats are 0.82-0.97)
export const SAME_FACT_LIKENESS = 0.85;

// The angles without the ones the AI says tell the same fact as an earlier one still shown, when their
// stories' likeness says so too (likeness(a, b): of two story ids)
export const sameFactsOut = (angles, likeness, min = SAME_FACT_LIKENESS) => angles.reduce((kept, other) =>
    other.sameAs && kept.some(one => one.storyId === other.sameAs) && likeness(other.storyId, other.sameAs) >= min
        ? kept : [...kept, other], []);

// A candidate closer to another card of the briefing than to its own, from this likeness, may tell
// that card's news: on briefing 98 of Enzo (25 cards, 14.10.2026) the FIFA's denial about Infantino's
// extra income was told in 12 languages, its card took 4 of them, and the others came back as
// "angles" of the Trump Tower and the FIFA election cards (0.83-0.94 to it): 5 of 72 angles told the
// fact of another card. The likeness alone does not tell them from right angles (bench/angles-cross-
// rule.mjs): leaving out the candidates closer to another card took 4 of the 5 away and 4-8 right
// angles a briefing; judging them below the closer card instead lost 7-11 right angles of 47 cards
// (that card had no place left, or called them its same fact). So the AI is told those other cards
// (bench/angles-move-data.mjs, then REJUDGE of bench/angles-places.mjs, same candidates, 2 runs):
// briefing 98, other cards' facts 5 -> 1, right angles 32 -> 31-32 (44-46% -> 48-49%); the 47 cards of
// briefings 90-92, right angles 102-103 -> 105-106 (78-79% -> 80-81%)
export const CLOSER_CARD_LIKENESS = 0.78;
const MAX_OTHER_CARDS = 3;

// The other cards some candidates of each card are closer to, from 'min': Map card id -> [card ids],
// the closest first. cards [{id, others}], likeness(storyId, cardId)
export const nearCardsOf = (cards, likeness, min = CLOSER_CARD_LIKENESS) => new Map(cards.map(card => {
    const near = new Map();
    for (const other of card.others) {
        const own = likeness(other.storyId, card.id);
        for (const another of cards) {
            const value = another.id === card.id ? -Infinity : likeness(other.storyId, another.id);
            if (value >= min && value > own) near.set(another.id, Math.max(near.get(another.id) ?? 0, value));
        }
    }
    return [card.id, [...near].sort((a, b) => b[1] - a[1]).slice(0, MAX_OTHER_CARDS).map(([id]) => id)];
}));

// The angles shown below a card, 'max' at most, in their order. The ones found by the card's names only
// (named, see affair-names.js) come after the closest: the Latvian federation backing Infantino was the
// third angle of three of its card on 13.10.2026, three angles closer would have left it out. The first
// of them takes the last place when the closest fill all of them
export const placeAngles = (angles, max = MAX_ANGLES) => {
    const shown = angles.slice(0, max);
    const named = angles.find(other => other.named);
    if (!named || shown.some(other => other.named)) return shown;
    return [...shown.slice(0, max - 1), named];
};

// cards: [{id, title, titles, at, others: [{title, at, ...}]}], the others the closest first, titles
// the other ones of the card, at the days (see anglesPrompt). Answers a Map id ->
// the others that are angles of its affair; a card the AI failed on has none
export const otherAnglesOf = async (cards, usage = null) => {
    const asked = cards.filter(card => card.others.length > 0);
    const results = await mapWithConcurrency(asked, AI_CONCURRENCY, async (card) =>
        normalizeAngles(await ollamaJson(anglesPrompt(card.title, card.others, card.titles ?? [], card.at, card.otherCards ?? []), usage), card.others));
    const failed = results.filter(result => result.status !== 'fulfilled').length;
    if (failed > 0) console.error(`Briefing: the other angles of ${failed} cards were not judged`);
    return new Map(asked.map((card, i) => [card.id, results[i].status === 'fulfilled' ? results[i].value : []]));
};
