// The three ways of a card, AI written against as published, on the 30 articles of the faithfulness
// bench: node bench/formats-run.mjs [run]   writes data/faithful/formats-<run>.json (run 1 by default)
//   ai-points   3-4 points of at most 15 words, written by the AI in the reader's language
//   ai-summary  one paragraph of 5-6 lines at most (~380 characters at the width of a card)
//   pub-points  the 3 sentences the AI finds most important, one point each, as published
//   pub-summary the most important sentences while they fit 65 words, as published
// the published ones are translated (marked) for a reader of another language, as the key passages.
// Reader: French for the fr and enfr articles, English for the en ones (as extract-run.mjs)
import 'dotenv/config';
import fs from 'node:fs';
import {extractPrompt, keepsFigures, sentencesOf, translationFor} from '../services/utils/extract.js';
import {newUsage, ollamaJson} from '../services/utils/ollama.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';
import {SUMMARY_WORDS, numbered, pointsPrompt, summaryPrompt, unnumbered} from './formats-prompts.mjs';

const run = process.argv[2] ?? '1';
const articles = JSON.parse(fs.readFileSync(new URL('./data/faithful/articles.json', import.meta.url), 'utf8'));
const reader = (id) => id.startsWith('en') && !id.startsWith('enfr') ? 'en' : 'fr';
const NAMES = {fr: 'French', en: 'English'};
const words = (text) => (text ?? '').split(/\s+/).filter(Boolean).length;
const LINE_CHARS = 66;           // .body-text max-width 66ch, the column of a card
const usage = {aiPoints: newUsage(), aiSummary: newUsage(), pub: newUsage()};
const seconds = {aiPoints: 0, aiSummary: 0, pub: 0};
const timed = async (key, call) => {
    const start = Date.now();
    try {
        return await call();
    } finally {
        seconds[key] += (Date.now() - start) / 1000;
    }
};

// the published ones: the order of importance the AI gives (extract.js), the first 3 sentences for the
// points; for the summary, while they fit SUMMARY_WORDS (the first always), set back in the order of
// the article
const published = async (a, sentences, language) => {
    const answer = await ollamaJson(extractPrompt(a.title, sentences), usage.pub);
    const order = [...new Set((answer?.sentences ?? []).filter(n => Number.isInteger(n) && sentences[n - 1]))];
    const points = order.slice(0, 3).map(n => [sentences[n - 1]]);
    const kept = [];
    let count = 0;
    for (const n of order) {
        if (kept.length > 0 && count + words(sentences[n - 1].text) > SUMMARY_WORDS) continue;
        kept.push(n);
        count += words(sentences[n - 1].text);
    }
    const summary = kept.sort((x, y) => x - y).map(n => [sentences[n - 1]]);
    const [pointsTr, summaryTr] = await Promise.all([
        translationFor(points, language, usage.pub),
        translationFor(summary, language, usage.pub),
    ]);
    const show = (passages, translation) => (translation.translation ?? passages).map(([s]) => s.quote ? `“${s.text}”` : s.text);
    return {
        order,
        points: show(points, pointsTr),
        pointsOriginal: pointsTr.translation ? points.map(([s]) => s.text) : null,
        summary: show(summary, summaryTr).join(' […] '),
        summaryOriginal: summaryTr.translation ? summary.map(([s]) => s.text).join(' […] ') : null,
        translated: Boolean(pointsTr.translation || summaryTr.translation),
        untranslated: (pointsTr.from && pointsTr.from !== language && !pointsTr.translation) || (summaryTr.from && summaryTr.from !== language && !summaryTr.translation),
    };
};

const measure = (texts, article) => {
    const all = texts.join(' ');
    return {
        words: words(all),
        chars: all.length,
        lines: texts.reduce((sum, text) => sum + Math.ceil(text.length / LINE_CHARS), 0),
        // a figure written that the article never gives (checked by hand: "deux" written "2" is no error)
        figuresNotInArticle: !keepsFigures(all, article),
    };
};

const results = await mapWithConcurrency(articles, 2, async (a) => {
    const sentences = sentencesOf({content: a.text, blocks: a.blocks});
    const articleText = sentences.map(s => s.text).join(' ');
    const lang = reader(a.id);
    const language = NAMES[lang];
    const [aiPoints, aiSummary, pub] = await Promise.all([
        timed('aiPoints', () => ollamaJson(pointsPrompt(a.title, sentences, language), usage.aiPoints)),
        timed('aiSummary', () => ollamaJson(summaryPrompt(a.title, sentences, language), usage.aiSummary)),
        run === '1' ? timed('pub', () => published(a, sentences, lang)) : null,
    ]);
    const points = (aiPoints?.points ?? []).filter(p => typeof p?.text === 'string');
    const out = {
        id: a.id, reader: lang, title: a.title, sentences: sentences.length,
        aiPoints: points.map(p => ({text: unnumbered(p.text), from: p.sentences ?? []})),
        aiPointsMeasure: measure(points.map(p => unnumbered(p.text)), articleText),
        aiSummary: typeof aiSummary?.summary === 'string' ? unnumbered(aiSummary.summary) : null,
        aiSummaryFrom: aiSummary?.sentences ?? [],
        aiSummaryNumbersInText: /\[\d+/.test(aiSummary?.summary ?? ''),
        aiSummaryMeasure: measure([unnumbered(aiSummary?.summary ?? '')], articleText),
    };
    if (pub) {
        Object.assign(out, {pub, pubPointsMeasure: measure(pub.points, articleText), pubSummaryMeasure: measure([pub.summary], articleText)});
    }
    return out;
});
const out = results.map((r, i) => r.status === 'fulfilled' ? r.value : {id: articles[i].id, error: String(r.reason)});
fs.writeFileSync(new URL(`./data/faithful/formats-${run}.json`, import.meta.url), JSON.stringify(out, null, 1));

const avg = (key, field) => {
    const values = out.map(r => r[key]?.[field]).filter(v => typeof v === 'number');
    return values.length ? (values.reduce((s, v) => s + v, 0) / values.length).toFixed(1) : '-';
};
const max = (key, field) => Math.max(...out.map(r => r[key]?.[field] ?? 0));
console.log(`run ${run}: tokens ${JSON.stringify(usage)}, seconds ${JSON.stringify(Object.fromEntries(Object.entries(seconds).map(([k, v]) => [k, Math.round(v)])))}`);
for (const key of ['aiPointsMeasure', 'aiSummaryMeasure', 'pubPointsMeasure', 'pubSummaryMeasure']) {
    console.log(`${key}: words ${avg(key, 'words')}, lines ${avg(key, 'lines')} (max ${max(key, 'lines')}), figures not in the article ${out.filter(r => r[key]?.figuresNotInArticle).map(r => r.id).join(' ') || 'none'}`);
}
for (const r of out) {
    if (r.error) console.log(`${r.id}: ${r.error}`);
    else console.log(`${r.id}: ${r.aiPoints.length} points (${r.aiPoints.map(p => words(p.text)).join('/')} words), summary ${r.aiSummaryMeasure.words} words ${r.aiSummaryMeasure.lines} lines${r.pub ? `, published ${r.pub.points.length} points (${r.pub.points.map(words).join('/')}), summary ${r.pubSummaryMeasure.words} words${r.pub.untranslated ? ' NOT TRANSLATED' : ''}` : ''}`);
}
process.exit(0);
