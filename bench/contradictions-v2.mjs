// Read only, second try of bench/contradictions.mjs: can a card say "another medium writes otherwise"
// without being wrong? Three steps, each written for reading by hand (bench/data/contradictions-v2.*):
//   1. inside a card: its articles of 2+ media read again, sentences numbered, the AI names the pairs
//      that cannot both be true (stricter: no prediction, no lineup announced, no rounding, no 1 unit);
//   2. every pair checked again by a second call, with the sentences around it and the dates;
//   3. across the affair: the other stories of the card's thread (3 days around it), their titles,
//      the AI names the ones that deny the card or give another figure, checked again the same way.
//   node --env-file=.env bench/contradictions-v2.mjs [days] [maxCards] [maxThreadCards]
import process from 'node:process';
import fs from 'node:fs';
import {prisma} from '../config/db.js';
import {Crawlers} from '../services/utils/crawlers.js';
import {sentencesOf} from '../services/utils/extract.js';
import {ollamaJson, newUsage} from '../services/utils/ollama.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';

const days = Number(process.argv[2] ?? 14);
const maxCards = Number(process.argv[3] ?? 120);
const maxThreadCards = Number(process.argv[4] ?? 200);
const PER_CARD = 4;
const SENTENCES = 40;
const CONTEXT = 2;                  // sentences on each side of a sentence of a pair, for the check
const usage = {detect: newUsage(), verify: newUsage(), thread: newUsage()};

const rows = await prisma.$queryRawUnsafe(`
    SELECT id, id_user, created_at, items FROM briefings
    WHERE status = 'ready' AND created_at > now() - make_interval(days => $1)
    ORDER BY created_at DESC`, days);

// every card once (the newest), with its articles one per medium, the lead first
const cards = [];
const seen = new Set();
for (const row of rows) {
    for (const item of Array.isArray(row.items) ? row.items : []) {
        if (seen.has(item.storyId)) continue;
        seen.add(item.storyId);
        const sources = new Set();
        const articles = [item.lead, ...(item.articles ?? [])].filter(a => a?.url && !/news\.google\.com/.test(a.url))
            .filter(a => !sources.has(a.source) && sources.add(a.source)).slice(0, PER_CARD);
        cards.push({briefing: row.id, at: row.created_at, storyId: item.storyId, title: item.title,
                    summary: (item.summary ?? '').slice(0, 500), media: item.corroboration?.media ?? 0, articles});
    }
}

// --- the check of one difference, the same for both steps
const verifyPrompt = (a, b) => `Two news texts on the same story. A reader would be told "another medium writes otherwise".
Decide whether that would be TRUE and USEFUL.

TEXT A (${a.source}, published ${a.publishedAt ?? 'unknown'}):
${a.context}

TEXT B (${b.source}, published ${b.publishedAt ?? 'unknown'}):
${b.context}

The difference claimed: in A "${a.sentence}" against in B "${b.sentence}".

- same_fact: both speak of exactly the same thing (same match, same person, same count, same scope and period)
- same_moment: about the same moment, not a figure that changed, a lineup announced then played, a score at half time
- stated: both are stated as facts, no "would", "could", "expected", rumour, prediction or promise
- incompatible: both cannot be true at once
- minor: only a minute, one unit of a count in a match report, or a rounding
- verdict: "show" only when same_fact, same_moment, stated and incompatible are true and minor is false, else "drop"
Answer in JSON only, no comment:
{"same_fact": true, "same_moment": true, "stated": true, "incompatible": true, "minor": false, "verdict": "show", "reason": "a few words"}`;

const verify = async (a, b) => {
    const answer = await ollamaJson(verifyPrompt(a, b), usage.verify).catch(() => null);
    return answer ?? {verdict: 'drop', reason: 'no answer'};
};

// --- 1 and 2: inside a card
const withMedia = cards.filter(card => card.media >= 2 && card.articles.length >= 2).slice(0, maxCards);
const pages = await Crawlers.Html([...new Set(withMedia.flatMap(card => card.articles.map(a => a.url)))]);
const byUrl = new Map(pages.map(page => [page.url, page]));

const detectPrompt = (title, texts) => `These articles were grouped as telling the same news ("${title}").
Each sentence has a number: [article.sentence].

${texts.map((t, i) => `ARTICLE ${i + 1} (${t.source}, published ${t.publishedAt ?? 'unknown'}):\n${t.sentences.map((s, j) => `[${i + 1}.${j + 1}] ${s}`).join('\n')}`).join('\n\n')}

Find the places where two DIFFERENT articles state facts that cannot both be true about exactly the same
thing at the same moment: a different figure for the same count, a different result, score, winner, rank,
date, place or person, one says an event happened and another that it did not, a claim and its denial.
NOT a contradiction: a later update (a toll that rose, a score at half time and at the end), a lineup or
a result announced before and the one that happened, anything in the conditional or a prediction, a
promise or an ambition against a measure, a detail only one article gives, opinions or emphasis, a
rounding (1.86 m / 1.87 m), a minute or one unit apart in a match report, two people quoted disagreeing.
Answer in JSON only: {"contradictions": [{"a": "1.4", "b": "2.7", "about": "a few words", "kind": "figure|result|person|event|denial|other"}]}
Most groups have none: answer {"contradictions": []} when you are not sure.`;

const inCards = await mapWithConcurrency(withMedia, 4, async (card) => {
    const texts = card.articles.map(a => ({...a, page: byUrl.get(a.url)}))
        .filter(a => a.page)
        .map(a => ({source: a.source, url: a.url, publishedAt: a.publishedAt, sentences: sentencesOf(a.page).map(s => s.text).slice(0, SENTENCES)}))
        .filter(t => t.sentences.length >= 3);
    if (texts.length < 2) return {...card, read: texts.length, pairs: []};
    const answer = await ollamaJson(detectPrompt(card.title, texts), usage.detect).catch(() => null);
    const at = (ref) => {
        const [i, j] = String(ref ?? '').split('.').map(Number);
        const t = texts[i - 1];
        if (!t?.sentences[j - 1]) return null;
        const context = t.sentences.slice(Math.max(0, j - 1 - CONTEXT), j + CONTEXT).join(' ');
        return {article: i, source: t.source, publishedAt: t.publishedAt, sentence: t.sentences[j - 1], context};
    };
    const pairs = (answer?.contradictions ?? []).map(c => ({a: at(c.a), b: at(c.b), about: c.about, kind: c.kind}))
        .filter(p => p.a && p.b && p.a.article !== p.b.article);
    for (const pair of pairs) pair.check = await verify(pair.a, pair.b);
    return {...card, read: texts.length, pairs};
});
const cardResults = inCards.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean);

// --- 3: across the affair, the other stories of the thread of the card
const siblingsOf = async (card) => prisma.$queryRawUnsafe(`
    SELECT DISTINCT ON (a.id_story) a.id_story AS story, a.title, a.description, a.medium, a.created_at
    FROM stories s1
    JOIN stories s2 ON s2.id_thread = s1.id_thread AND s2.id <> s1.id
    JOIN articles a ON a.id_story = s2.id
    WHERE s1.id = $1 AND s1.id_thread IS NOT NULL
      AND a.created_at BETWEEN $2::timestamptz - interval '3 days' AND $2::timestamptz + interval '3 days'
    ORDER BY a.id_story, a.created_at
    LIMIT 30`, card.storyId, card.at);

const threadPrompt = (card, others) => `A news card, then other news of the same affair.

CARD: ${card.title}
${card.summary}

OTHER NEWS:
${others.map((o, i) => `[${i + 1}] (${o.medium}, ${o.created_at.toISOString().slice(0, 16)}) ${o.title}${o.description ? ' — ' + o.description.replace(/<[^>]*>/g, ' ').slice(0, 200) : ''}`).join('\n')}

Which of the other news state something that cannot be true together with what the card states: a denial
of the card's claim, another figure, result, winner or person for exactly the same fact at the same moment?
NOT: a later development, a reaction, an opinion, a prediction, a rumour reported as a rumour, the same
news told differently, another fact of the same affair.
Answer in JSON only: {"contradicting": [{"n": 3, "card_says": "a few words", "other_says": "a few words", "kind": "denial|figure|result|person|event|other"}]}
Most cards have none: answer {"contradicting": []} when you are not sure.`;

const threadCards = cards.slice(0, maxThreadCards);
const inThreads = await mapWithConcurrency(threadCards, 4, async (card) => {
    const others = await siblingsOf(card);
    if (others.length === 0) return {...card, siblings: 0, found: []};
    const answer = await ollamaJson(threadPrompt(card, others), usage.thread).catch(() => null);
    const found = [];
    for (const c of answer?.contradicting ?? []) {
        const other = others[Number(c.n) - 1];
        if (!other) continue;
        const a = {source: card.articles[0]?.source ?? 'card', publishedAt: card.articles[0]?.publishedAt, sentence: card.title,
                   context: `${card.title}. ${card.summary}`};
        const b = {source: other.medium, publishedAt: other.created_at.toISOString(), sentence: other.title,
                   context: `${other.title}. ${(other.description ?? '').replace(/<[^>]*>/g, ' ').slice(0, 400)}`};
        found.push({other, cardSays: c.card_says, otherSays: c.other_says, kind: c.kind, check: await verify(a, b)});
    }
    return {...card, siblings: others.length, found};
});
const threadResults = inThreads.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean);

// --- written for reading by hand
const read = cardResults.filter(c => c.read >= 2);
const pairs = read.flatMap(c => c.pairs.map(p => ({card: c, ...p})));
const shown = pairs.filter(p => p.check?.verdict === 'show');
const withSiblings = threadResults.filter(c => c.siblings > 0);
const tFound = withSiblings.flatMap(c => c.found.map(f => ({card: c, ...f})));
const tShown = tFound.filter(f => f.check?.verdict === 'show');
const lines = [
    `inside cards: ${withMedia.length} cards of 2+ media, ${read.length} with 2+ texts read, pairs ${pairs.length}, kept by the check ${shown.length} (cards ${new Set(shown.map(p => p.card.storyId)).size})`,
    `across threads: ${threadCards.length} cards, ${withSiblings.length} with other stories in their thread, found ${tFound.length}, kept by the check ${tShown.length} (cards ${new Set(tShown.map(f => f.card.storyId)).size})`,
    `tokens ${JSON.stringify(usage)}`,
    '\n===== INSIDE CARDS ====='];
for (const p of pairs) {
    lines.push(`\n#${p.card.storyId} ${p.card.title}`);
    lines.push(`  ${p.check?.verdict === 'show' ? 'SHOW' : 'drop'} [${p.kind}] ${p.about} — check: ${p.check?.reason ?? ''} ${JSON.stringify({f: p.check?.same_fact, m: p.check?.same_moment, s: p.check?.stated, i: p.check?.incompatible, minor: p.check?.minor})}`);
    lines.push(`    A ${p.a.source} (${p.a.publishedAt?.slice(0, 16) ?? '?'}): ${p.a.sentence}`);
    lines.push(`    B ${p.b.source} (${p.b.publishedAt?.slice(0, 16) ?? '?'}): ${p.b.sentence}`);
}
lines.push('\n===== ACROSS THREADS =====');
for (const f of tFound) {
    lines.push(`\n#${f.card.storyId} ${f.card.title} (${f.card.media} media)`);
    lines.push(`  ${f.check?.verdict === 'show' ? 'SHOW' : 'drop'} [${f.kind}] card: ${f.cardSays} / other: ${f.otherSays} — check: ${f.check?.reason ?? ''}`);
    lines.push(`    other #${f.other.story} ${f.other.medium} (${f.other.created_at.toISOString().slice(0, 16)}): ${f.other.title}`);
}
fs.writeFileSync(new URL('./data/contradictions-v2.json', import.meta.url), JSON.stringify({cardResults, threadResults}, null, 1));
fs.writeFileSync(new URL('./data/contradictions-v2.txt', import.meta.url), lines.join('\n') + '\n');
console.log(lines.slice(0, 3).join('\n'));
process.exit(0);
