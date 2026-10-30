// The AI-written ways of a card (formats-run.mjs, same prompts) written by another Ollama cloud model,
// then the "grounded" check by gemma4:31b: node bench/formats-models.mjs <model> [run] [think]
//   writes data/faithful/models-<model>-<run>.json (':' and '.' of the tag become '-')
//   think: 'off' (default, think: false sent) or 'none' (the param not sent, as production sends it
//   for gemma4:31b) or a level ('low')
// Only Ollama: a client of its own, no Gemini fallback (it would answer with gemma for another model),
// at most BENCH_CONCURRENCY calls at once (4: Ollama takes 6 for the whole key, the server uses it too),
// "too many concurrent requests" asked again after a wait.
// Grounded: each point gives the numbers of the sentences it comes from (the prompt asks it already);
// gemma4:31b is asked, one call per card, whether each point is fully supported by its sentences; a
// point that is not is replaced by the sentence the checker names (one of its own, as published,
// translated for the reader as the key passages). The summary is checked sentence by sentence against
// the sentences it gives, a sentence not supported replaced the same way.
// The usage of the key (/api/usage, USD and tokens of 7 days) is read before, between the writing and
// the checks, and after, to tell what each model cost.
import 'dotenv/config';
import fs from 'node:fs';
import {Ollama} from 'ollama';
import {keepsFigures, sentencesOf, translationFor} from '../services/utils/extract.js';
import {newUsage} from '../services/utils/ollama.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';
import {numbered, pointsPrompt, summaryPrompt, unnumbered} from './formats-prompts.mjs';

const [model, run = '1', thinkArg = 'off'] = process.argv.slice(2);
if (!model) throw new Error('usage: node bench/formats-models.mjs <model> [run] [think]');
const CHECK_MODEL = 'gemma4:31b';
const think = thinkArg === 'off' ? false : thinkArg === 'none' ? undefined : thinkArg;
const slug = model.replace(/[:.]/g, '-');
// BENCH_ONLY=fr0,en3 runs these articles only (a try), written to models-<model>-<run>.try.json
const only = process.env.BENCH_ONLY?.split(',');
const articles = JSON.parse(fs.readFileSync(new URL('./data/faithful/articles.json', import.meta.url), 'utf8'))
    .filter(a => !only || only.includes(a.id));
const reader = (id) => id.startsWith('en') && !id.startsWith('enfr') ? 'en' : 'fr';
const NAMES = {fr: 'French', en: 'English'};
const words = (text) => (text ?? '').split(/\s+/).filter(Boolean).length;
const LINE_CHARS = 66;
const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY) || 4;
const BUSY_WAITS_MS = [2e3, 5e3, 10e3, 20e3, 30e3];
const TIMEOUT_MS = 180e3;
const headers = {Authorization: 'Bearer ' + process.env.OLLAMA_API_KEY};

let running = 0;
const waiting = [];
const inTurn = async (task) => {
    if (running >= CONCURRENCY) await new Promise(resolve => waiting.push(resolve));
    else running++;
    try {
        return await task();
    } finally {
        const next = waiting.shift();
        if (next) next(); else running--;
    }
};

const stats = {busy: 0, retries: 0, failed: 0};
// one call: {json, input, output, thinking, seconds}; the time counted is the one of the call itself,
// not the wait for a place
const askOnce = async (name, prompt, thinkValue) => inTurn(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`no answer in ${TIMEOUT_MS / 1e3} s`)), TIMEOUT_MS);
    const ollama = new Ollama({host: 'https://ollama.com', headers, fetch: (url, init) => fetch(url, {...init, signal: controller.signal})});
    const start = Date.now();
    try {
        const response = await ollama.chat({
            model: name,
            format: 'json',
            messages: [{role: 'user', content: prompt}],
            ...(thinkValue === undefined ? {} : {think: thinkValue}),
            options: {temperature: 0.1},
        });
        const raw = response.message.content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
        return {raw, input: response.prompt_eval_count ?? 0, output: response.eval_count ?? 0,
            thinking: (response.message.thinking ?? '').length, seconds: (Date.now() - start) / 1000};
    } finally {
        clearTimeout(timer);
    }
});
const isBusy = (err) => err.status_code === 429 && /concurren/i.test(err.message ?? '');
const ask = async (name, prompt, usage, thinkValue) => {
    let busy = 0;
    for (let attempt = 0; attempt < 3;) {
        try {
            const answer = await askOnce(name, prompt, thinkValue);
            usage.calls += 1;
            usage.input += answer.input;
            usage.output += answer.output;
            usage.seconds = (usage.seconds ?? 0) + answer.seconds;
            usage.thinking = (usage.thinking ?? 0) + answer.thinking;
            try {
                return {...JSON.parse(answer.raw), _seconds: answer.seconds};
            } catch {
                usage.noJson = (usage.noJson ?? 0) + 1;
                throw new Error(`no JSON: ${answer.raw.slice(0, 120)}`);
            }
        } catch (err) {
            if (isBusy(err) && busy < BUSY_WAITS_MS.length) {
                stats.busy++;
                await new Promise(resolve => setTimeout(resolve, BUSY_WAITS_MS[busy++]));
                continue;
            }
            attempt++;
            stats.retries++;
            if (attempt >= 3) {
                stats.failed++;
                console.error(`${name}: failed ${err.status_code ?? ''} ${err.message}`);
                return null;
            }
        }
    }
    return null;
};

const readUsage = async () => {
    const response = await fetch('https://ollama.com/api/usage', {headers});
    const body = await response.json();
    return {at: new Date().toISOString(), ...body.totals};
};
// the usage counts a call some seconds after its answer: read again until 'calls' more requests are
// counted than in 'from' (the server's own calls count too) and the count stays the same 15 s, 4 min max
const settledUsage = async (from, calls) => {
    let last = await readUsage();
    for (const end = Date.now() + 240e3; Date.now() < end;) {
        await new Promise(resolve => setTimeout(resolve, 15e3));
        const now = await readUsage();
        if (now.request_count >= from.request_count + calls && now.request_count === last.request_count) return now;
        last = now;
    }
    return {...last, unsettled: true};
};

// the summary cut in sentences, to check them one by one: an end only after a small letter, a figure
// or a closing quote ("M. Dupont", "ID. Polo", "U.S. officials" or "3.5" are no end)
const summarySentences = (text) => (text ?? '').split(/(?<=[a-zà-ÿ0-9)»"”’][.!?…])\s+(?=[«"“A-ZÀ-ÖØ-Þ0-9])/u).filter(s => s.trim());

const checkPrompt = (items, sentences) => `You check statements written from a news article against the sentences of the
article each statement says it comes from. A statement may be in another language than its sentences:
judge its meaning.
A statement is "supported" only if everything it says is stated by its sentences:
- the same people or organisations doing and saying the same things (never the words or the act of one
  given to another, or to a group, and never an analysis or an opinion of the article told as a fact),
- the same figures, places, dates, roles and titles, none added,
- the same certainty: what the sentences say is likely, alleged, planned, demanded or unconfirmed stays
  so,
- no cause or purpose the sentences do not state, nothing else added.
A sentence marked (quote) is someone's words quoted by the article: the statement must say who says it.
When a statement is not supported, "sentence" is the number of the one of its sentences that holds its
main fact.

${items.map((item, i) => `STATEMENT ${i + 1}: ${item.text}
ITS SENTENCES:
${item.from.length ? item.from.map(n => `[${n}]${sentences[n - 1].quote ? ' (quote)' : ''} ${sentences[n - 1].text}`).join('\n') : '(none)'}`).join('\n\n')}

Answer only in JSON: {"statements": [{"statement": number, "supported": true or false, "problem": "what is not in its sentences, or empty", "sentence": number}]}`;

const valid = (from, sentences) => [...new Set((Array.isArray(from) ? from : []).filter(n => Number.isInteger(n) && sentences[n - 1]))];

// the check of a list of statements {text, from}: each gets {supported, problem, replacement}; the
// replacement is the sentence named (one of its own, else its first), null when it has none
const grounded = async (items, sentences, usage) => {
    if (items.length === 0) return [];
    const answer = await ask(CHECK_MODEL, checkPrompt(items, sentences), usage, undefined);
    const verdicts = Array.isArray(answer?.statements) ? answer.statements : [];
    return items.map((item, i) => {
        const verdict = verdicts.find(v => v?.statement === i + 1);
        // no verdict (the check failed) is no proof: the statement is replaced
        const supported = item.from.length > 0 && verdict?.supported === true;
        const named = item.from.includes(verdict?.sentence) ? verdict.sentence : item.from[0];
        return {supported, checked: Boolean(verdict), problem: verdict?.problem || null, replacement: supported ? null : named ?? null};
    });
};

// the replacements as the reader sees them: the sentence as published, translated (marked) when the
// article is in another language
const shown = async (numbers, sentences, language, usage) => {
    const passages = numbers.map(n => [sentences[n - 1]]);
    if (passages.length === 0) return [];
    const {translation} = await translationFor(passages, language, usage);
    return (translation ?? passages).map(([s], i) => ({n: numbers[i], text: s.quote ? `“${s.text}”` : s.text, translated: Boolean(translation)}));
};

const measure = (texts, article) => {
    const all = texts.join(' ');
    return {
        words: words(all),
        chars: all.length,
        lines: texts.reduce((sum, text) => sum + Math.ceil(text.length / LINE_CHARS), 0),
        figuresNotInArticle: !keepsFigures(all, article),
    };
};

const usage = {points: newUsage(), summary: newUsage(), checkPoints: newUsage(), checkSummary: newUsage(), translate: newUsage()};
const usageAt = {before: await readUsage()};
const startedAt = Date.now();

// 1. the writing, by the model
const written = await mapWithConcurrency(articles, 4, async (a) => {
    const sentences = sentencesOf({content: a.text, blocks: a.blocks});
    const language = NAMES[reader(a.id)];
    const [points, summary] = await Promise.all([
        ask(model, pointsPrompt(a.title, sentences, language), usage.points, think),
        ask(model, summaryPrompt(a.title, sentences, language), usage.summary, think),
    ]);
    return {a, sentences, points, summary};
});
usageAt.written = await settledUsage(usageAt.before, usage.points.calls + usage.summary.calls);
const writingSeconds = (Date.now() - startedAt) / 1000;

// 2. the check by gemma4:31b, and the replacements
const out = await mapWithConcurrency(written.map(r => r.value), 4, async ({a, sentences, points, summary}) => {
    const articleText = sentences.map(s => s.text).join(' ');
    const lang = reader(a.id);
    const aiPoints = (Array.isArray(points?.points) ? points.points : []).filter(p => typeof p?.text === 'string')
        .map(p => ({text: unnumbered(p.text), from: valid(p.sentences, sentences)}));
    const summaryText = typeof summary?.summary === 'string' ? unnumbered(summary.summary) : null;
    const summaryFrom = valid(summary?.sentences, sentences);
    const summaryParts = summarySentences(summaryText).map(text => ({text, from: summaryFrom}));

    const [pointsCheck, summaryCheck] = await Promise.all([
        grounded(aiPoints, sentences, usage.checkPoints),
        grounded(summaryParts, sentences, usage.checkSummary),
    ]);
    // a summary sentence replaced by a sentence already shown is dropped
    const used = new Set();
    const summaryReplacements = summaryCheck.map(c => {
        if (!c.replacement || used.has(c.replacement)) return null;
        used.add(c.replacement);
        return c.replacement;
    });
    const [pointsShown, summaryShown] = await Promise.all([
        shown(pointsCheck.map(c => c.replacement).filter(Boolean), sentences, lang, usage.translate),
        shown(summaryReplacements.filter(Boolean), sentences, lang, usage.translate),
    ]);
    const take = (list) => (n) => list.find(s => s.n === n);
    const groundedPoints = aiPoints.map((p, i) => pointsCheck[i].supported ? {text: p.text, ai: true}
        : pointsCheck[i].replacement ? {...take(pointsShown)(pointsCheck[i].replacement), ai: false} : null).filter(Boolean);
    const groundedSummary = summaryParts.map((p, i) => summaryCheck[i].supported ? {text: p.text, ai: true}
        : summaryReplacements[i] ? {...take(summaryShown)(summaryReplacements[i]), ai: false} : null).filter(Boolean);

    return {
        id: a.id, reader: lang, title: a.title, sentences: sentences.length,
        pointsSeconds: points?._seconds ?? null, summarySeconds: summary?._seconds ?? null,
        aiPoints, aiPointsMeasure: measure(aiPoints.map(p => p.text), articleText),
        pointsNumbersInText: (points?.points ?? []).some(p => /\[\d+|\(\d+\)/.test(p?.text ?? '')),
        aiSummary: summaryText, aiSummaryFrom: summaryFrom, aiSummaryParts: summaryParts.map(p => p.text),
        summaryNumbersInText: /\[\d+|\(\d+\)/.test(summary?.summary ?? ''),
        aiSummaryMeasure: measure([summaryText ?? ''], articleText),
        pointsCheck, summaryCheck,
        groundedPoints, groundedPointsMeasure: measure(groundedPoints.map(p => p.text), articleText),
        groundedSummary, groundedSummaryMeasure: measure([groundedSummary.map(p => p.text).join(' ')], articleText),
    };
});
usageAt.after = await settledUsage(usageAt.written, usage.checkPoints.calls + usage.checkSummary.calls + usage.translate.calls);

const results = out.map((r, i) => r.status === 'fulfilled' ? r.value : {id: articles[i].id, error: String(r.reason)});
const ok = results.filter(r => !r.error);
const sum = (list, f) => list.reduce((s, r) => s + (f(r) ?? 0), 0);
const avg = (list, f) => list.length ? +(sum(list, f) / list.length).toFixed(1) : null;
const delta = (from, to) => ({usd: +(to.usage_usd - from.usage_usd).toFixed(5), requests: to.request_count - from.request_count,
    input: to.input_tokens - from.input_tokens, output: to.output_tokens - from.output_tokens});
const summary = {
    model, run, think: thinkArg, checkModel: CHECK_MODEL, articles: ok.length, failed: results.length - ok.length,
    stats, writingSeconds: Math.round(writingSeconds), usage, usageAt,
    cost: {writing: delta(usageAt.before, usageAt.written), check: delta(usageAt.written, usageAt.after)},
    secondsPerCall: {points: avg(ok, r => r.pointsSeconds), summary: avg(ok, r => r.summarySeconds)},
    points: {count: avg(ok, r => r.aiPoints.length), ...Object.fromEntries(['words', 'lines'].map(k => [k, avg(ok, r => r.aiPointsMeasure[k])])),
        maxLines: Math.max(...ok.map(r => r.aiPointsMeasure.lines)), noPoints: ok.filter(r => r.aiPoints.length === 0).map(r => r.id),
        numbersInText: ok.filter(r => r.pointsNumbersInText).map(r => r.id), figuresNotInArticle: ok.filter(r => r.aiPointsMeasure.figuresNotInArticle).map(r => r.id)},
    summaryText: {...Object.fromEntries(['words', 'lines'].map(k => [k, avg(ok, r => r.aiSummaryMeasure[k])])),
        maxLines: Math.max(...ok.map(r => r.aiSummaryMeasure.lines)), none: ok.filter(r => !r.aiSummary).map(r => r.id),
        numbersInText: ok.filter(r => r.summaryNumbersInText).map(r => r.id), figuresNotInArticle: ok.filter(r => r.aiSummaryMeasure.figuresNotInArticle).map(r => r.id)},
    grounded: {
        pointsReplaced: `${sum(ok, r => r.pointsCheck.filter(c => !c.supported).length)}/${sum(ok, r => r.pointsCheck.length)}`,
        pointsCardsTouched: ok.filter(r => r.pointsCheck.some(c => !c.supported)).length,
        summaryReplaced: `${sum(ok, r => r.summaryCheck.filter(c => !c.supported).length)}/${sum(ok, r => r.summaryCheck.length)}`,
        summaryCardsTouched: ok.filter(r => r.summaryCheck.some(c => !c.supported)).length,
        checkFailed: sum(ok, r => [...r.pointsCheck, ...r.summaryCheck].filter(c => !c.checked).length),
        pointsWords: avg(ok, r => r.groundedPointsMeasure.words), pointsLines: avg(ok, r => r.groundedPointsMeasure.lines),
        summaryWords: avg(ok, r => r.groundedSummaryMeasure.words), summaryLines: avg(ok, r => r.groundedSummaryMeasure.lines),
    },
};
fs.writeFileSync(new URL(`./data/faithful/models-${slug}-${run}${only ? '.try' : ''}.json`, import.meta.url), JSON.stringify({summary, results}, null, 1));
console.log(JSON.stringify(summary, null, 1));
for (const r of results) if (r.error) console.log(`${r.id}: ${r.error}`);
process.exit(0);
