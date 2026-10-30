// Read only: how often the articles of a briefing card contradict each other, and whether the AI can
// tell it. The cards of the last days told by 2 media or more: up to PER_CARD articles of different
// media read again, their sentences numbered (as extract.js shows them), and the AI asked which
// sentences of two articles cannot both be true. It answers by numbers, so a pair shown is always the
// articles' own words. Written for reading by hand: bench/data/contradictions.{json,txt}.
//   node --env-file=.env bench/contradictions.mjs [days] [maxCards]
import process from 'node:process';
import fs from 'node:fs';
import {prisma} from '../config/db.js';
import {Crawlers} from '../services/utils/crawlers.js';
import {sentencesOf} from '../services/utils/extract.js';
import {ollamaJson, newUsage} from '../services/utils/ollama.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';

const days = Number(process.argv[2] ?? 14);
const maxCards = Number(process.argv[3] ?? 120);
const PER_CARD = 4;
const SENTENCES = 40;
const usage = newUsage();

const rows = await prisma.$queryRawUnsafe(`
    SELECT id, id_user, created_at, items FROM briefings
    WHERE status = 'ready' AND created_at > now() - make_interval(days => $1)
    ORDER BY created_at DESC`, days);

// one card per story, the newest; its articles one per medium, the lead first
const cards = [];
const seen = new Set();
for (const row of rows) {
    for (const item of Array.isArray(row.items) ? row.items : []) {
        if ((item.corroboration?.media ?? 0) < 2 || seen.has(item.storyId)) continue;
        seen.add(item.storyId);
        const sources = new Set();
        const articles = [item.lead, ...(item.articles ?? [])].filter(a => a?.url && !/news\.google\.com/.test(a.url))
            .filter(a => !sources.has(a.source) && sources.add(a.source)).slice(0, PER_CARD);
        if (articles.length >= 2) cards.push({briefing: row.id, user: row.id_user, storyId: item.storyId, title: item.title, articles});
    }
}
const picked = cards.slice(0, maxCards);
console.log(`cards with 2+ media ${cards.length}, read ${picked.length}`);

const pages = await Crawlers.Html([...new Set(picked.flatMap(card => card.articles.map(a => a.url)))]);
const byUrl = new Map(pages.map(page => [page.url, page]));

const prompt = (title, texts) => `These articles were grouped as telling the same news ("${title}").
Each sentence has a number: [article.sentence].

${texts.map((t, i) => `ARTICLE ${i + 1} (${t.source}, published ${t.publishedAt ?? 'unknown'}):\n${t.sentences.map((s, j) => `[${i + 1}.${j + 1}] ${s}`).join('\n')}`).join('\n\n')}

Find the places where two DIFFERENT articles state facts that cannot both be true about the same thing at
the same moment: a different figure for the same count, a different result, score, winner, date, place or
person, one says an event happened and another that it did not, one reports a claim and another its denial.
NOT a contradiction: a later update (a toll that rose, a score at half time and at the end), a detail only
one article gives, opinions or emphasis, rounding, two people quoted disagreeing (both articles report the
disagreement), a prediction against a result.
Answer in JSON only: {"contradictions": [{"a": "1.4", "b": "2.7", "about": "a few words", "kind": "figure|result|event|denial|other"}]}
Most groups have none: answer {"contradictions": []} when you are not sure.`;

const results = await mapWithConcurrency(picked, 4, async (card) => {
    const texts = card.articles.map(a => ({...a, page: byUrl.get(a.url)}))
        .filter(a => a.page)
        .map(a => ({source: a.source, url: a.url, publishedAt: a.publishedAt, sentences: sentencesOf(a.page).map(s => s.text).slice(0, SENTENCES)}))
        .filter(t => t.sentences.length >= 3);
    if (texts.length < 2) return {...card, read: texts.length, pairs: []};
    const answer = await ollamaJson(prompt(card.title, texts), usage).catch(() => null);
    const at = (ref) => {
        const [i, j] = String(ref ?? '').split('.').map(Number);
        const t = texts[i - 1];
        return t?.sentences[j - 1] ? {article: i, source: t.source, publishedAt: t.publishedAt, sentence: t.sentences[j - 1]} : null;
    };
    const pairs = (answer?.contradictions ?? []).map(c => ({a: at(c.a), b: at(c.b), about: c.about, kind: c.kind}))
        .filter(p => p.a && p.b && p.a.article !== p.b.article);
    return {...card, read: texts.length, answered: Boolean(answer), pairs};
});
const done = results.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean);

const readCards = done.filter(c => c.read >= 2);
const flagged = readCards.filter(c => c.pairs.length > 0);
const lines = [`cards ${picked.length}, with 2+ articles read ${readCards.length}, flagged ${flagged.length}, pairs ${flagged.reduce((s, c) => s + c.pairs.length, 0)}, tokens ${JSON.stringify(usage)}`];
for (const c of flagged) {
    lines.push(`\n#${c.storyId} (briefing ${c.briefing}) ${c.title}`);
    for (const p of c.pairs) {
        lines.push(`  [${p.kind}] ${p.about}`);
        lines.push(`    A ${p.a.source} (${p.a.publishedAt?.slice(0, 16) ?? '?'}): ${p.a.sentence}`);
        lines.push(`    B ${p.b.source} (${p.b.publishedAt?.slice(0, 16) ?? '?'}): ${p.b.sentence}`);
    }
}
fs.writeFileSync(new URL('./data/contradictions.json', import.meta.url), JSON.stringify(done, null, 1));
fs.writeFileSync(new URL('./data/contradictions.txt', import.meta.url), lines.join('\n') + '\n');
console.log(lines[0]);
process.exit(0);
