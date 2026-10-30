// Read only, third way of finding the contradictions of a story (after bench/contradictions-world.mjs):
// the AI never judges whether two sentences contradict, it only reads facts, and the code decides.
//   1. a list of the facts of the story to read (questions), from its titles;
//   2. each article answers them: a value, its unit, approximate or provisional, who says it, and the
//      number of its sentence (so what is shown is always the article's own words); and the denials it
//      reports, with who denies;
//   3. the code compares: numbers converted (currencies, scales), within a tolerance, the provisional
//      ones left out; the answers in words grouped by meaning (one small AI call per question);
//   4. a divergence is kept when each version is given by MIN_PER_SIDE media or more, and the two were
//      published at the same time (one only later than the other is a figure that changed).
// The same stories as contradictions-world.mjs (bench/data/contradictions-world.json), up to PER_STORY
// articles of different media each. Written to bench/data/contradictions-facts.{json,txt}.
//   node --env-file=.env bench/contradictions-facts.mjs [maxStories]
import process from 'node:process';
import fs from 'node:fs';
import {prisma} from '../config/db.js';
import {Crawlers} from '../services/utils/crawlers.js';
import {sentencesOf} from '../services/utils/extract.js';
import {ollamaJson, newUsage} from '../services/utils/ollama.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';

const maxStories = Number(process.argv[2] ?? 100);
const PER_STORY = 8;
const SENTENCES = 40;
const MIN_PER_SIDE = 2;
const SAME_TIME_HOURS = 2;          // a version only later than the other by more than this: an update
const NUMBER_TOLERANCE = 0.03;      // relative, beyond the approximations the articles say
const CURRENCY_TOLERANCE = 0.08;    // the rates below are rough
const usage = {facts: newUsage(), answers: newUsage(), groups: newUsage()};
let failed = 0;
// a call of the AI asked again after a pause: many at once were refused (429) in the first run
const askJson = async (prompt, use) => {
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            return await ollamaJson(prompt, use);
        } catch {
            await new Promise(resolve => setTimeout(resolve, 3000 * (attempt + 1)));
        }
    }
    failed++;
    return null;
};

// rough rates to euros, enough to tell 1 billion euros and 850 million pounds are one amount
const TO_EUR = {EUR: 1, USD: 0.88, GBP: 1.17, CHF: 1.07, AUD: 0.58, CAD: 0.63, JPY: 0.0059, INR: 0.0105,
                CNY: 0.12, RUB: 0.011, UAH: 0.021, BRL: 0.16, TRY: 0.022, ILS: 0.24, SEK: 0.084, NOK: 0.083,
                DKK: 0.134, PLN: 0.23, MXN: 0.047, ZAR: 0.049, KES: 0.0068, AED: 0.24, SAR: 0.23};

const world = JSON.parse(fs.readFileSync(new URL('./data/contradictions-world.json', import.meta.url), 'utf8'));
const storyIds = world.cardResults.map(card => card.storyId).slice(0, maxStories);

const stories = [];
for (const storyId of storyIds) {
    const news = await prisma.$queryRawUnsafe(`
        SELECT DISTINCT ON (a.medium) a.medium, a.title, a.description, COALESCE(a.resolved_link, a.link) AS url,
               COALESCE(a.published_at, a.created_at) AS at, a.lang
        FROM articles a WHERE a.id_story = $1 AND a.medium IS NOT NULL
          AND COALESCE(a.resolved_link, a.link) !~ 'news[.]google[.]com'
        ORDER BY a.medium, a.created_at DESC`, storyId);
    news.sort((a, b) => b.at - a.at);
    if (news.length >= 2) stories.push({storyId, title: news[0].title, lang: news[0].lang, media: news.length, news: news.slice(0, PER_STORY * 2)});
}
const pages = await Crawlers.Html([...new Set(stories.flatMap(story => story.news.map(a => a.url)))]);
const byUrl = new Map(pages.map(page => [page.url, page]));
for (const story of stories) {
    story.texts = story.news.map(a => ({medium: a.medium, at: a.at, url: a.url, page: byUrl.get(a.url)}))
        .filter(a => a.page)
        .map(a => ({medium: a.medium, at: a.at, url: a.url, sentences: sentencesOf(a.page).map(s => s.text).slice(0, SENTENCES)}))
        .filter(t => t.sentences.length >= 3)
        .slice(0, PER_STORY);
}
const readable = stories.filter(story => story.texts.length >= 2 * MIN_PER_SIDE);
console.log(`stories ${stories.length}, with ${2 * MIN_PER_SIDE}+ articles read ${readable.length}, articles ${readable.reduce((s, x) => s + x.texts.length, 0)}`);

// --- 1. the facts to read
const factsPrompt = (story) => `Here are the titles of articles of different media telling one news.

${story.news.slice(0, 12).map(a => `- (${a.medium}) ${a.title}`).join('\n')}

Write the 4 to 8 key FACTS of this news a reader could check, as short questions, each about ONE precise
thing with its scope: a count (say what is counted: "people killed", "passengers, crew not included"),
an amount, a result or score, a winner, the person who did or said something, a weapon or a cause, a
place, a date. No opinion, no prediction, no "why", no yes/no question ("Did X arrive?"): ask what can
be answered by a value ("Which weapon was used?", "How many seats did the party win?").
Answer in JSON only: {"facts": [{"q": "How many people were injured?", "kind": "number|amount|words"}]}`;

// --- 2. what each article says of them
const answerPrompt = (facts, text) => `Questions on a news:
${facts.map((f, i) => `Q${i + 1}. ${f.q}`).join('\n')}

An article (${text.medium}), each sentence numbered:
${text.sentences.map((s, j) => `[${j + 1}] ${s}`).join('\n')}

For each question the article ANSWERS (skip the others), give:
- "q": its number; "sentence": the number of the sentence that says it;
- "value": the answer in a few English words, exactly what the article says (no inference);
- "number": for a count or an amount, the plain number in units (1.4 million -> 1400000), else null;
- "unit": a currency code (EUR, USD, GBP...) for an amount, else what is counted or null;
- "approx": "exact", "about", "more_than" or "less_than", as the article says it;
- "provisional": true when the article says it is partial, provisional, so far, early, expected, a
  forecast or a rumour;
- "said_by": who the article says gives it ("police", "Netanyahu"), or null when the article states it.
And the DENIALS the article reports: someone named denying a claim.
Answer in JSON only: {"answers": [{"q": 1, "sentence": 4, "value": "...", "number": null, "unit": null,
"approx": "exact", "provisional": false, "said_by": null}], "denials": [{"denied_by": "...", "claim": "...", "sentence": 7}]}`;

// --- 3. two answers in words of one question: can both be true? (a question per pair: a list to group
// was answered by copying the example of the prompt)
const bothPrompt = (q, x, y) => `Two articles answer the question: "${q}"
Answer X: ${x.value}
  as article X wrote it: "${x.quote}"
Answer Y: ${y.value}
  as article Y wrote it: "${y.quote}"

Judge from what the articles wrote, not from what you know. Can X and Y both be true at once? They can when they say the same thing in other words, when one is more
precise than the other (a place and a square of it, a person and their title, a part of a list and the
list), or when they speak of different things. They cannot only when one excludes the other.
Answer in JSON only, with a few words of why: {"why": "...", "both_true": false}`;

const inEur = (a) => a.unit && TO_EUR[a.unit.toUpperCase()] ? a.number * TO_EUR[a.unit.toUpperCase()] : null;
// the interval an answer allows, as the article put it
const rangeOf = (value, approx, tolerance) => {
    if (approx === 'more_than') return [value, Infinity];
    if (approx === 'less_than') return [0, value];
    const t = approx === 'about' ? Math.max(tolerance, 0.1) : tolerance;
    return [value * (1 - t), value * (1 + t)];
};
const overlap = ([a1, a2], [b1, b2]) => a1 <= b2 && b1 <= a2;

// numbers: two answers are one version when their intervals overlap; versions built by joining
const numberGroups = (answers, kind) => {
    const ranges = answers.map(a => {
        const eur = kind === 'amount' ? inEur(a) : null;
        const value = eur ?? a.number;
        return rangeOf(value, a.approx, eur !== null ? CURRENCY_TOLERANCE : NUMBER_TOLERANCE);
    });
    const group = answers.map((_, i) => i);
    const find = (i) => group[i] === i ? i : (group[i] = find(group[i]));
    for (let i = 0; i < answers.length; i++) {
        for (let j = i + 1; j < answers.length; j++) {
            // one more of a count (22 / 23 shots) is no divergence worth a reader's time
            const small = kind === 'number' && Math.abs(answers[i].number - answers[j].number) <= 1;
            if (small || overlap(ranges[i], ranges[j])) group[find(j)] = find(i);
        }
    }
    const byRoot = new Map();
    answers.forEach((a, i) => byRoot.set(find(i), [...(byRoot.get(find(i)) ?? []), a]));
    return [...byRoot.values()];
};

const results = await mapWithConcurrency(readable, 2, async (story) => {
    const facts = (await askJson(factsPrompt(story), usage.facts))?.facts ?? [];
    if (facts.length === 0) return {...story, facts, divergences: [], updates: [], outliers: [], denials: []};
    const answered = await mapWithConcurrency(story.texts, 3, async (text) => {
        const answer = await askJson(answerPrompt(facts, text), usage.answers);
        const sentence = (n) => text.sentences[Number(n) - 1] ?? null;
        return {
            answers: (answer?.answers ?? []).map(a => ({...a, medium: text.medium, at: text.at, quote: sentence(a.sentence)}))
                .filter(a => a.quote && facts[Number(a.q) - 1]),
            denials: (answer?.denials ?? []).map(d => ({...d, medium: text.medium, at: text.at, quote: sentence(d.sentence)}))
                .filter(d => d.quote && d.denied_by),
        };
    });
    const all = answered.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
    const divergences = [], updates = [], outliers = [];
    for (let qi = 0; qi < facts.length; qi++) {
        const fact = facts[qi];
        const answers = all.flatMap(r => r.answers).filter(a => Number(a.q) === qi + 1 && !a.provisional);
        if (new Set(answers.map(a => a.medium)).size < 2) continue;
        let groups;
        const numeric = (fact.kind === 'number' || fact.kind === 'amount') && answers.every(a => Number.isFinite(Number(a.number)) && a.number !== null);
        if (numeric) {
            groups = numberGroups(answers.map(a => ({...a, number: Number(a.number)})), fact.kind);
        } else {
            const values = [...new Set(answers.map(a => String(a.value ?? "").toLowerCase().trim()))].slice(0, 8);
            if (values.length === 1) continue;
            const group = values.map((_, i) => i);
            const find = (i) => group[i] === i ? i : (group[i] = find(group[i]));
            for (let i = 0; i < values.length; i++) {
                for (let j = i + 1; j < values.length; j++) {
                    if (find(i) === find(j)) continue;
                    const quoteOf = (value) => answers.find(a => String(a.value ?? "").toLowerCase().trim() === value);
                    const answer = await askJson(bothPrompt(fact.q, quoteOf(values[i]), quoteOf(values[j])), usage.groups);
                    if (answer?.both_true !== false) group[find(j)] = find(i);
                }
            }
            const byGroup = new Map();
            for (const a of answers) {
                const index = values.indexOf(String(a.value ?? "").toLowerCase().trim());
                if (index < 0) continue;
                byGroup.set(find(index), [...(byGroup.get(find(index)) ?? []), a]);
            }
            groups = [...byGroup.values()];
        }
        if (groups.length < 2) continue;
        const sides = groups.map(g => ({answers: g, media: new Set(g.map(a => a.medium)),
                                        first: Math.min(...g.map(a => +a.at)), last: Math.max(...g.map(a => +a.at))}))
            .sort((a, b) => b.media.size - a.media.size);
        const strong = sides.filter(s => s.media.size >= MIN_PER_SIDE);
        const entry = {q: fact.q, kind: fact.kind, sides: sides.map(s => ({media: [...s.media], answers: s.answers}))};
        if (strong.length >= 2) {
            // one version only published after the other: a figure that changed, not two versions
            const [a, b] = strong;
            const later = a.first > b.last + SAME_TIME_HOURS * 3600e3 || b.first > a.last + SAME_TIME_HOURS * 3600e3;
            (later ? updates : divergences).push(entry);
        } else if (strong.length === 1) {
            outliers.push(entry);
        }
    }
    return {...story, facts, divergences, updates, outliers, denials: all.flatMap(r => r.denials)};
});
const done = results.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean);

const fmt = (a) => `${a.medium} ${new Date(a.at).toISOString().slice(5, 16)}${a.said_by ? ` (says ${a.said_by})` : ''}: «${a.quote.slice(0, 260)}»`;
const lines = [
    `stories ${done.length}, articles ${done.reduce((s, x) => s + x.texts.length, 0)}, facts ${done.reduce((s, x) => s + x.facts.length, 0)}`,
    `divergences shown ${done.reduce((s, x) => s + x.divergences.length, 0)} (stories ${done.filter(x => x.divergences.length).length}), updates ${done.reduce((s, x) => s + x.updates.length, 0)}, single-medium outliers ${done.reduce((s, x) => s + x.outliers.length, 0)}, denials ${done.reduce((s, x) => s + x.denials.length, 0)} (stories ${done.filter(x => x.denials.length).length})`,
    `tokens ${JSON.stringify(usage)}, calls failed after 4 tries ${failed}`];
const block = (title, key) => {
    lines.push(`\n===== ${title} =====`);
    for (const story of done) {
        for (const d of story[key]) {
            lines.push(`\n#${story.storyId} ${story.title} [${story.lang}, ${story.media} media]`);
            lines.push(`  Q: ${d.q}`);
            for (const side of d.sides) {
                lines.push(`  -- ${side.answers[0].value} (${side.media.length} media)`);
                for (const a of side.answers.slice(0, 3)) lines.push(`     ${fmt(a)}`);
            }
        }
    }
};
block('DIVERGENCES (2+ media each side, same time)', 'divergences');
block('UPDATES (one version only later)', 'updates');
lines.push('\n===== DENIALS =====');
for (const story of done) {
    for (const d of story.denials) lines.push(`#${story.storyId} ${story.title.slice(0, 80)}\n  ${d.denied_by} denies "${d.claim}" — ${fmt(d)}`);
}
block('OUTLIERS (one side with 1 medium, not shown)', 'outliers');
fs.writeFileSync(new URL('./data/contradictions-facts.json', import.meta.url), JSON.stringify(done.map(({news, texts, ...rest}) => rest), null, 1));
fs.writeFileSync(new URL('./data/contradictions-facts.txt', import.meta.url), lines.join('\n') + '\n');
console.log(lines.slice(0, 3).join('\n'));
process.exit(0);
