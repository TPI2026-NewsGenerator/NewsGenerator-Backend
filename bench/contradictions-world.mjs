// Read only: bench/contradictions-v2.mjs on the news where contradictions should be the most frequent:
// the stories of the last 48 hours of politics and world news (a news of a world or politics feed of
// db/rss-links.js) told by 4 media or more, every language. Same three steps (detection inside the
// story, a second check of each pair, denials across its thread), written to bench/data/contradictions-world.*
//   node --env-file=.env bench/contradictions-world.mjs [hours] [maxStories] [maxThreadStories]
import process from 'node:process';
import fs from 'node:fs';
import {prisma} from '../config/db.js';
import {rss} from '../db/rss-links.js';
import {Crawlers} from '../services/utils/crawlers.js';
import {sentencesOf} from '../services/utils/extract.js';
import {ollamaJson, newUsage} from '../services/utils/ollama.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';

const WINDOW = Number(process.argv[2] ?? 48);
const maxCards = Number(process.argv[3] ?? 100);
const maxThreadCards = Number(process.argv[4] ?? 100);
const MIN_MEDIA = 4;
const PER_CARD = 4;
const SENTENCES = 40;
const CONTEXT = 2;                  // sentences on each side of a sentence of a pair, for the check
const usage = {detect: newUsage(), verify: newUsage(), thread: newUsage()};

// the stories of the last WINDOW hours with a news of a world or politics feed, told by MIN_MEDIA media or
// more, the most told first; their articles one per medium, the newest first, never a link of Google News
const worldFeeds = [...new Set(Object.values(rss).flatMap(categories => [...(categories.world ?? []), ...(categories.politics ?? [])]))];
const stories = await prisma.$queryRawUnsafe(`
    WITH s AS (
        SELECT a.id_story, count(DISTINCT a.medium) AS media
        FROM articles a
        WHERE a.id_story IS NOT NULL AND a.created_at > now() - make_interval(hours => $2)
        GROUP BY a.id_story
        HAVING count(DISTINCT a.medium) >= $3
           AND bool_or(a.id_feed IN (SELECT id FROM feeds WHERE url = ANY($1)))
    )
    SELECT s.id_story, s.media::int AS media FROM s ORDER BY s.media DESC LIMIT $4`, worldFeeds, WINDOW, MIN_MEDIA, maxCards);
const cards = [];
for (const story of stories) {
    const news = await prisma.$queryRawUnsafe(`
        SELECT DISTINCT ON (a.medium) a.medium, a.title, a.description, COALESCE(a.resolved_link, a.link) AS url,
               COALESCE(a.published_at, a.created_at) AS at, a.lang
        FROM articles a WHERE a.id_story = $1 AND a.medium IS NOT NULL
          AND COALESCE(a.resolved_link, a.link) !~ 'news\.google\.com'
        ORDER BY a.medium, a.created_at DESC`, story.id_story);
    news.sort((a, b) => b.at - a.at);
    if (news.length < 2) continue;
    cards.push({storyId: story.id_story, at: news[0].at, title: news[0].title, lang: news[0].lang,
                summary: (news[0].description ?? '').replace(/<[^>]*>/g, ' ').slice(0, 500), media: story.media,
                articles: news.slice(0, PER_CARD).map(a => ({url: a.url, source: a.medium, publishedAt: a.at.toISOString()}))});
}
console.log(`stories of world/politics told by ${MIN_MEDIA}+ media: ${stories.length}, with 2+ readable links ${cards.length}`);

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
    lines.push(`\n#${p.card.storyId} ${p.card.title} [${p.card.lang}, ${p.card.media} media]`);
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
fs.writeFileSync(new URL('./data/contradictions-world.json', import.meta.url), JSON.stringify({cardResults, threadResults}, null, 1));
fs.writeFileSync(new URL('./data/contradictions-world.txt', import.meta.url), lines.join('\n') + '\n');
console.log(lines.slice(0, 3).join('\n'));
process.exit(0);
