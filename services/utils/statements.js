//
//  Author: Fabian Rostello
//  Date: 14.10.2026
//  File: statements.js
//  Description: The statements of a card's parties its own articles report ("in a statement", "a
//               annoncé dans un communiqué", "ha confermato"): a sentence quoted word for word where the
//               party the news is about makes it official itself, read by the AI as Contested reads a
//               denial. Shown with the official sources (see official-sources.js)
//

"use strict"

import {languageOf} from './language.js';
import {sentencesOf} from './extract.js';
import {ollamaJson} from './ollama.js';

// Measured on the 163 cards of bench/official-badge.mjs (bench/official-embeds.mjs, judged by hand):
// the posts of the parties the media embed are none of them theirs (journalists, fans: 27 posts on 15
// cards), but their statements reported in the articles gave 24 cards, 20 right, 17 of them without
// an official post (the FPF suspending Ronaldo, UEFA sanctioning Serbia, Vega announcing his
// candidacy). The 4 wrong ones were an expert's opinion, another announcement of the party months
// before, "a source of Benfica" and an example of a past decision: the prompt says them, and a
// sentence counts only when two answers, the sentences in another order, read it so. Announcements
// mostly: the transfers are still told by journalists, none confirmed this way
const MAX_CANDIDATES = 25;

// the words of a reported statement, in the languages of the cards: a sentence without one is never
// read. Its channel: a statement, a release, a website or an account
const CHANNEL = [
    // en
    String.raw`\bstatements?\b`, String.raw`\bpress release`, String.raw`\bofficially\b`,
    String.raw`\b(?:confirm|announc)\w*\b.{0,60}\b(?:website|on x\b|twitter|instagram|facebook|social media|tiktok|its channels)`,
    String.raw`\b(?:posted|wrote|said) on (?:x|twitter|instagram|facebook)\b`,
    // fr
    String.raw`communiqu[ée]`, String.raw`officialis`, String.raw`sur (?:son|ses|leur|leurs) (?:site|compte|réseaux)`,
    // es, pt ("os erros sejam comunicados" is no release)
    String.raw`\bcomunicado\b`, String.raw`oficializ`, String.raw`nota oficial`, String.raw`(?:sus|suas) redes`,
    // it
    String.raw`\bcomunicato\b`, String.raw`ufficializ`, String.raw`nota ufficiale`,
    // de, nl
    String.raw`Mitteilung`, String.raw`Stellungnahme`, String.raw`\boffiziell\b`, String.raw`verklaring`, String.raw`persbericht`,
];
// or only the verb of a journalist telling it: "X a annoncé sa candidature"
const SAYING = [
    String.raw`\b(?:a|ont) (?:confirmé|annoncé)`, String.raw`\b(?:confirmó|anunció|confirmou|anunciou)\b`,
    String.raw`\bha (?:confermato|annunciato)\b`, String.raw`\b(?:bestätigte|gab .{0,40}bekannt)\b`, String.raw`\bbevestigde\b`,
    String.raw`maakte .{0,40}bekend`,
];
const STATEMENT = new RegExp([...CHANNEL, ...SAYING].join('|'), 'iu');
const BY_CHANNEL = new RegExp(CHANNEL.join('|'), 'iu');
const QUOTED = /["«»“”„]/u;

// whether a sentence reports a statement, an announcement or a post
export const hasStatement = (sentence) => STATEMENT.test(sentence);

// Whether a sentence of the card's own article only retells its news: "Le Slovène Aleksander Ceferin a
// annoncé jeudi sa candidature", shown as an official source below the card that article opens
// (14.10.2026). No channel, no quote: the reader learns nothing the card does not say. A statement, a
// release or a quote of the lead stays. On the 163 cards of bench/official-statements.mjs: 19 cards
// with a statement -> 17, Collina announcing the rules gone, Ceferin's candidacy told by another medium
// instead, UNUM's proposals "comunicados" (communicated) no release any more; AI calls 82 -> 70
export const retellsLead = (sentence) => !BY_CHANNEL.test(sentence) && !QUOTED.test(sentence);

// names: the parties of the card (see official-sources.js)
export const statementPrompt = (card, candidates, names) => `A news card: "${card.title}"${card.titleTranslation ? ` (${card.titleTranslation})` : ''}
The ones it is about: ${names.join(', ')}.

Sentences of articles on it:
${candidates.map((candidate, i) => `[${i + 1}] (${candidate.source}) ${candidate.sentence}`).join('\n')}

For each sentence, in this order:
said_by: who makes the statement, announcement or post the sentence reports, by their name; "" when
  nobody named does.
own: true only when that one is one of the ones the news is about (the person, the club, the body, the
  company) speaking for itself: its statement, release, website, own account, press conference, its
  president or spokesperson. false for a media, a journalist, an expert or a pundit, an agent, a source
  ("a source of the club" is not the club), someone close to them, another party.
confirms: true only when what they said is the card's news itself, the same fact as its title: the same
  decision, announcement, candidacy, sanction or figure. false for an earlier or another announcement,
  an example or a past case, a background, a denial, a refusal to comment, "has not confirmed", "awaits
  confirmation", "is expected to announce"; false for an opinion, a criticism or a prediction: only a
  fact is made official.
Answer in JSON only: {"sentences": [{"n": 1, "said_by": "who", "own": true, "confirms": true}]}`;

// the candidates both answers read as a party's own statement of the card's news, one per party
// (said_by), in their order; the second answer is of the candidates in the reverse order
export const confirmingOf = (first, second, candidates) => {
    const read = (answer, order) => new Map((Array.isArray(answer?.sentences) ? answer.sentences : [])
        .map(item => [order[Number(item?.n) - 1], item]).filter(([candidate]) => candidate !== undefined));
    const a = read(first, candidates), b = read(second, [...candidates].reverse());
    const yes = (item) => item?.own === true && item?.confirms === true && typeof item.said_by === 'string' && item.said_by.trim();
    const parties = new Set();
    return candidates.flatMap(candidate => {
        const one = a.get(candidate), two = b.get(candidate);
        if (!yes(one) || !yes(two)) return [];
        const by = one.said_by.trim();
        if (parties.has(by.toLowerCase())) return [];
        parties.add(by.toLowerCase());
        return [{...candidate, by}];
    });
};

// card: {title, titleTranslation}; texts: its articles read [{source, url, publishedAt, page, lead}],
// lead true for the article the card opens (see retellsLead); names: its parties. [{by, sentence,
// language, source, url, publishedAt}], empty when no sentence reports a statement or the card has no
// party; the AI asked twice only then
export const statementsOf = async (card, texts, names, usage = null) => {
    if (names.length === 0) return [];
    const seen = new Set();
    const candidates = texts.flatMap(text => {
        const language = languageOf(text.page?.content ?? '');
        return sentencesOf(text.page ?? {}).filter(sentence => hasStatement(sentence.text) && !(text.lead && retellsLead(sentence.text))
            && !seen.has(sentence.text) && seen.add(sentence.text))
            .map(sentence => ({sentence: sentence.text, language, source: text.source, url: text.url, publishedAt: text.publishedAt ?? null}));
    }).slice(0, MAX_CANDIDATES);
    if (candidates.length === 0) return [];
    const first = await ollamaJson(statementPrompt(card, candidates, names), usage);
    const second = await ollamaJson(statementPrompt(card, [...candidates].reverse(), names), usage);
    return confirmingOf(first, second, candidates);
};
