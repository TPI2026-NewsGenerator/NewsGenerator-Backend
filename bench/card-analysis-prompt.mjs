// The prompts of the per-card analysis bench (card-analysis-run.mjs) and the sources of a card as the AI
// reads them (card-analysis-checks.mjs checks the lines against the same texts).
//   triage   one call per briefing, the cards as the reader sees them (title, key passages) and a flag
//            "earlier stories of this affair on N earlier days": the cards that merit an analysis
//   analysis one call per picked card, its grounded sources, each with an id the lines cite:
//            A1 s12 = article 1 sentence 12, T3 = timeline item 3, G2 = other angle 2, D1 = denial 1,
//            O1 = official source 1, W1 = Wikidata description 1
import {writtenIn} from '../services/utils/language.js';

const TRIAGE_PASSAGES = 1600;

const triageCard = (card) => {
    const passages = (card.translation ?? card.passages).replace(/\n{2,}/g, '\n').slice(0, TRIAGE_PASSAGES);
    const days = card.timeline.days;
    return `[${card.n}] ${card.medium ?? 'unknown medium'}
Title: ${card.title}${card.titleTranslation ? `\nTitle translated: ${card.titleTranslation}` : ''}
History: ${days > 0 ? `earlier stories of this affair on ${days} earlier day${days > 1 ? 's' : ''}` : 'none found'}
Key passages${card.translation ? ' (translated)' : ''}:
${passages}`;
};

export const triagePrompt = (briefing) => {
    const language = writtenIn(briefing.language) ?? 'English';
    return `You choose which cards of a news briefing get a short analysis, for one reader. Each card is one news
story: its number, its medium, its title, its key passages (sentences copied from the article) and
whether earlier stories of the same affair were found on earlier days.

An analysis explains what the card alone does not: why the news matters, its stakes, how it fits an
affair, what comes next. Give one only to a card that merits it:
- its stakes are not visible in its title (a decision whose consequences the passages tell);
- it is part of an affair or a conflict, with or without earlier stories;
- it is disputed: an accusation, a denial, a criticism, a legal fight;
- it announces a next step: a vote, a trial, an appeal, a deadline, a threat, a decision to come;
- it rests on a mechanism worth explaining: a rule, a funding, a procedure, a law.
Give none to plain factual news that the title and passages tell in full: a match result, a routine
appointment, a referee designated, a product launch or update, a review, a schedule, a ranking.
Earlier stories alone are no reason: a series of match results is still plain news.
Picking no card is a good answer when none merits it; a forced pick is a wrong one.

CARDS

${briefing.cards.map(triageCard).join('\n\n')}

Answer only in JSON, the reasons in ${language}, at most 12 words each:
{"cards": [{"n": 3, "reason": "..."}]}`;
};

// the sources of a card: [{id, kind, text}], text = what the AI reads after the id
export const sourcesOf = (card) => {
    const sources = [];
    card.articles.forEach((a, i) => {
        a.sentences.forEach((s, j) => sources.push({id: `A${i + 1} s${j + 1}`, kind: 'article', text: s}));
    });
    card.timeline.items.forEach((t, i) => sources.push({id: `T${i + 1}`, kind: 'timeline', text: [t.title, t.titleTranslation].filter(Boolean).join(' / '), date: t.date}));
    card.angles.forEach((g, i) => sources.push({id: `G${i + 1}`, kind: 'angle', text: [g.title, g.titleTranslation].filter(Boolean).join(' / ')}));
    card.contested.forEach((d, i) => sources.push({id: `D${i + 1}`, kind: 'denial', text: [d.sentence, d.translation].filter(Boolean).join(' / ')}));
    card.official.forEach((o, i) => sources.push({id: `O${i + 1}`, kind: 'official', text: `${o.party ?? ''}: ${o.title ?? ''}`}));
    card.names.filter(n => n.description).forEach((n, i) => sources.push({id: `W${i + 1}`, kind: 'wikidata', text: `${n.name}: ${n.description}`}));
    return sources;
};

const day = (date) => date ? String(date).slice(0, 10) : 'undated';

export const sourcesText = (card) => {
    const parts = [];
    card.articles.forEach((a, i) => {
        parts.push(`ARTICLE A${i + 1}: ${a.source ?? 'unknown medium'}, ${day(a.publishedAt)}${i === 0 ? ' (the lead article of the card)' : ''}${a.read ? '' : ' (only its key passages could be read)'}
Title: ${a.title}
${a.sentences.map((s, j) => `s${j + 1} ${s}`).join('\n')}`);
    });
    if (card.timeline.items.length) parts.push(`TIMELINE: earlier stories of the same affair, oldest first (title only)
${card.timeline.items.map((t, i) => `T${i + 1} ${t.date} ${t.medium ?? ''}: ${t.title}${t.titleTranslation ? ` (translated: ${t.titleTranslation})` : ''}`).join('\n')}`);
    if (card.angles.length) parts.push(`OTHER ANGLES: other news of the same affair (title only)
${card.angles.map((g, i) => `G${i + 1} ${day(g.publishedAt)} ${g.source ?? ''}: ${g.title}${g.titleTranslation ? ` (translated: ${g.titleTranslation})` : ''}`).join('\n')}`);
    if (card.contested.length) parts.push(`DENIALS reported by the articles
${card.contested.map((d, i) => `D${i + 1} ${d.sentence}${d.translation ? ` (translated: ${d.translation})` : ''}`).join('\n')}`);
    if (card.official.length) parts.push(`OFFICIAL SOURCES: what a party of the news published itself (title only)
${card.official.map((o, i) => `O${i + 1} ${day(o.publishedAt)} ${o.party ?? ''}: ${o.title ?? ''}`).join('\n')}`);
    const described = card.names.filter(n => n.description);
    if (described.length) parts.push(`NAMES: what Wikidata says of names of the card
${described.map((n, i) => `W${i + 1} ${n.name}: ${n.description}`).join('\n')}`);
    return parts.join('\n\n');
};

export const analysisPrompt = (card, language) => {
    const written = writtenIn(language) ?? 'English';
    const seen = (card.translation ?? card.passages).replace(/\n{2,}/g, '\n');
    return `You write a short analysis of one news card for one reader, in ${written}. The reader already sees the
card: its title and its key passages (below). Your analysis tells what they do not: why the news
matters, what is at stake, how it fits the affair, what may come next. You only have the sources
below, each with an id. You know nothing else: no background knowledge, no other news, no guess.

THE CARD THE READER SEES
Title: ${card.title}${card.titleTranslation ? `\nTitle translated: ${card.titleTranslation}` : ''}
Key passages:
${seen}

SOURCES

${sourcesText(card)}

Write two parts:

1. "why": why this news matters, 1 to 3 lines of at most 30 words: its stakes, its consequences, the
   mechanism it rests on (a rule, a funding, a procedure), the dispute or the affair it is part of,
   as the sources tell them. A line only repeating the title or the key passages is useless: leave it
   out.

2. "next": what may come next, as "If X, then Y", 0 to 2 entries. Both X and Y are stated by the cited
   sources: a pending decision, a deadline, a vote, a trial, an appeal, a threat, a warning, or a
   consequence someone in the sources names. Never a consequence you imagine yourself. None in the
   sources: an empty list.

For every line:
- it cites the ids of the sources it relies on ("A1 s12", "T3", "G2"...), every one it uses;
- every name (person, organisation, place, product), every figure and every date is in the sources
  it cites (a name may be translated);
- the certainty of the sources is kept: what is planned, alleged, likely, demanded or a rumour stays
  so, and what someone says stays said by them;
- a timeline or angle title only tells that such a news was published, not that it is true;
- no opinion and no advice of your own;
- the ids go in "cites" only, never in the text.
Nothing beyond the card in the sources: answer empty lists. An empty answer is a good answer; a line
padded out of the card is a wrong one.

Answer only in JSON, all text in ${written}:
{"why": [{"text": "...", "cites": ["A1 s3", "T2"]}], "next": [{"if": "...", "then": "...", "cites": ["A2 s7"]}]}`;
};

// Variant 2 (round 2, 15.10): every view written with who holds it, no causal or purpose link no
// source makes, at most 2 "why" lines. Same sources, same output.
export const analysisPromptV2 = (card, language) => {
    const written = writtenIn(language) ?? 'English';
    const seen = (card.translation ?? card.passages).replace(/\n{2,}/g, '\n');
    return `You write a short analysis of one news card for one reader, in ${written}. The reader already sees the
card: its title and its key passages (below). Your analysis tells what they do not: why the news
matters, what is at stake, how it fits the affair, what may come next. You only have the sources
below, each with an id. You know nothing else: no background knowledge, no other news, no guess.

THE CARD THE READER SEES
Title: ${card.title}${card.titleTranslation ? `\nTitle translated: ${card.titleTranslation}` : ''}
Key passages:
${seen}

SOURCES

${sourcesText(card)}

Write two parts:

1. "why": why this news matters, 1 or 2 lines of at most 30 words: its stakes, its consequences, the
   mechanism it rests on (a rule, a funding, a procedure), the dispute or the affair it is part of,
   as the sources tell them. A line only repeating the title or the key passages is useless: leave it
   out.

2. "next": what may come next, as "If X, then Y", 0 to 2 entries. Both X and Y are stated by the cited
   sources as a possible next step: a pending decision, a deadline, a vote, a trial, an appeal, a
   threat, a warning, or a consequence someone in the sources names. Never a consequence you imagine
   yourself, never two facts you join yourself. None in the sources: an empty list.

For every line:
- it cites the ids of the sources it relies on ("A1 s12", "T3", "G2"...), every one it uses;
- every name (person, organisation, place, product), every figure and every date is in the sources
  it cites (a name may be translated);
- every opinion, forecast, demand, accusation or claim is written with who says it ("X says...",
  "according to Y..."), never as a fact: a journalist, a columnist, a club, an expert or a company
  saying something is not the thing being true;
- no "so", "because", "therefore", "in order to", "which means" or other link of cause, consequence or
  purpose unless a cited source states that very link; two facts side by side stay two facts;
- the certainty of the sources is kept: what is planned, alleged, likely, demanded or a rumour stays
  so ("may" stays "may", never "will");
- a timeline or angle title only tells that such a news was published, not that it is true;
- no opinion and no advice of your own;
- the ids go in "cites" only, never in the text.
Nothing beyond the card in the sources: answer empty lists. An empty answer is a good answer; a line
padded out of the card is a wrong one.

Answer only in JSON, all text in ${written}:
{"why": [{"text": "...", "cites": ["A1 s3", "T2"]}], "next": [{"if": "...", "then": "...", "cites": ["A2 s7"]}]}`;
};

// a "next" line as it would be shown: the "If"/"then" words the AI writes around X and Y taken out, as
// briefing-analysis.js does
const condition = (text) => String(text ?? '').trim().replace(/^(?:if|si|wenn|se|als)\s+/i, '').replace(/[,;:\s]+$/, '');
const consequence = (text) => String(text ?? '').trim().replace(/^(?:then|alors|dann|allora|dan|entonces)\s+/i, '');
export const nextText = (line) => `${condition(line?.if)} → ${consequence(line?.then)}`;

// A line as it would be shown (round 3, 15.10): ids the AI wrote in its text taken out when between
// parentheses ("(A1 s3, s4)"), an article id left in the text swapped for the article's medium
// ("A1 says" -> "goal.com says", "selon A1 s54" -> "selon goal.com")
export const shownText = (card, text) => String(text ?? '')
    .replace(/\s*\((?:[^()]*\b(?:A\d+|s\d+|[TGDOW]\d+)\b[^()]*)\)/g, '')
    .replace(/\bA(\d+)(?:\s*,?\s*s\d+(?:\s*[-–]\s*s?\d+)?)?\b/g, (id, n) => card.articles[Number(n) - 1]?.source ?? id);
