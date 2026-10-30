// The points and the summary of a card made of pieces of the article, never written by the AI: it
// copies a whole sentence or a part of one, the code checks the piece is in the sentence word for
// word, else it is not shown. On the 30 articles of the faithfulness bench, to compare with the AI
// written ones of formats-run.mjs: node bench/formats-pieces.mjs [run]
// writes data/faithful/pieces-<run>.json. Reader: French for fr and enfr, English for en; the pieces
// of another language get the marked machine translation of the key passages
import 'dotenv/config';
import fs from 'node:fs';
import {keepsFigures, sentencesOf, translationFor} from '../services/utils/extract.js';
import {newUsage, ollamaJson} from '../services/utils/ollama.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';

const run = process.argv[2] ?? '1';
const articles = JSON.parse(fs.readFileSync(new URL('./data/faithful/articles.json', import.meta.url), 'utf8'));
const reader = (id) => id.startsWith('en') && !id.startsWith('enfr') ? 'en' : 'fr';
const words = (text) => (text ?? '').split(/\s+/).filter(Boolean).length;
const LINE_CHARS = 66;
const POINT_WORDS = 20;
const SUMMARY_WORDS = 65;
const usage = {points: newUsage(), summary: newUsage(), translation: newUsage()};
const seconds = {points: 0, summary: 0};
const timed = async (key, call) => {
    const start = Date.now();
    try {
        return await call();
    } finally {
        seconds[key] += (Date.now() - start) / 1000;
    }
};

const numbered = (sentences) => sentences.map((sentence, i) => `[${i + 1}]${sentence.quote ? ' (quote)' : ''} ${sentence.text}`).join('\n');

const COPY_RULES = `- Copy exactly, character for character: the same words in the same order, nothing added, changed
  or left out inside the piece. A piece is inside ONE sentence.
- A piece never leaves out who said it when its sentence says it ("according to X", "X says"), nor
  the words of certainty (may, should, expected, reportedly, planned, alleged), nor a negation or a
  condition.
- A piece makes sense on its own: no "he", "she", "it", "this", "these" without saying who or what.
- A sentence marked (quote) is someone's words: only pick a piece of it that says who speaks.
- Never text that is not the news: ads, cookies, subscriptions, "read also", captions, credits.`;

const pointsPrompt = (title, sentences) => `You pick the key points of a news article for a reader who reads it in a few seconds. You never
write: each point is a piece of text copied word for word from the article, a whole sentence or a
part of one that makes sense on its own. The reader sees it as the article published it.
Rules:
- 3 or 4 points, 2 for a short article, the most important first. Together they say who did what,
  when and where, and the main figures.
- Each point at most ${POINT_WORDS} words: take the part of a long sentence that says the point.
${COPY_RULES}

TITLE: ${title}

SENTENCES:
${numbered(sentences)}

Answer only in JSON: {"points": [{"sentence": number, "text": "the piece, copied"}]}`;

const summaryPrompt = (title, sentences) => `You make a short summary of a news article out of its own words, for a reader who has 20 seconds.
You never write: the summary is made of pieces of text copied word for word from the article, whole
sentences or parts of them that make sense on their own, shown in the order of the article with
[…] between two pieces that do not follow each other.
Rules:
- 2 to 4 pieces, at most ${SUMMARY_WORDS} words together. Together they say who did what, when and
  where, and the main figures.
${COPY_RULES}

TITLE: ${title}

SENTENCES:
${numbered(sentences)}

Answer only in JSON: {"pieces": [{"sentence": number, "text": "the piece, copied"}]}`;

// quotes and apostrophes as one character each, so a piece copied with ' finds the ’ of the
// sentence; the same length, so a place in one is a place in the other
const plain = (text) => text.replace(/[’‘`´]/g, "'").replace(/[“”«»„]/g, '"').replace(/ | /g, ' ');
// the piece as the sentence writes it, with its place: null when it is not in the sentence word for word
const findPiece = (sentences, {sentence, text}) => {
    const source = sentences[sentence - 1];
    if (!source || typeof text !== 'string') return null;
    const wanted = plain(text.replace(/\s+/g, ' ').trim()).replace(/^[.…\s]+|[…\s]+$/g, '');
    if (words(wanted) < 3) return null;
    const at = plain(source.text).indexOf(wanted);
    if (at < 0) return null;
    // a piece that stops before the full stop of its sentence keeps it: two pieces that follow each
    // other were read as one sentence ("…que prévu Martin Sander, directeur…")
    let end = at + wanted.length;
    if (/^[\s.!?…"”»)\]]*$/.test(source.text.slice(end))) end = source.text.length;
    return {
        sentence, start: at, quote: source.quote,
        whole: at === 0 && end === source.text.length,
        // cut on a side: the reader sees … there
        text: `${at > 0 ? '…' : ''}${source.text.slice(at, end)}${end < source.text.length ? '…' : ''}`,
    };
};

// asked once more when fewer than 2 pieces are in the article word for word
const pick = async (prompt, key, field, max, sentences) => {
    let best = {kept: [], asked: 0, refused: 0};
    for (let attempt = 0; attempt < 2; attempt++) {
        const answer = await timed(key, () => ollamaJson(prompt, usage[key]));
        const given = (answer?.[field] ?? []).filter(piece => piece && typeof piece === 'object');
        const found = given.map(piece => findPiece(sentences, piece));
        const kept = [];
        let count = 0;
        for (const piece of found.filter(Boolean)) {
            if (kept.some(k => k.sentence === piece.sentence && k.start === piece.start)) continue;
            if (kept.length > 0 && count + words(piece.text) > max) continue;
            kept.push(piece);
            count += words(piece.text);
        }
        const result = {kept, asked: given.length, refused: found.filter(piece => !piece).length,
            refusedTexts: given.filter((piece, i) => !found[i]).map(piece => piece.text), attempt};
        if (kept.length > best.kept.length) best = result;
        if (kept.length >= 2 || sentences.length < 3) break;
    }
    return best;
};

const translated = async (pieces, language) => {
    const passages = pieces.map(piece => [{text: piece.text, quote: piece.quote}]);
    const {from, translation} = await translationFor(passages, language, usage.translation);
    return {from, translation: translation?.map(([piece]) => piece.text) ?? null};
};
const shown = (piece) => piece.quote ? `“${piece.text}”` : piece.text;

const measure = (texts, article) => {
    const all = texts.join(' ');
    return {words: words(all), chars: all.length,
        lines: texts.reduce((sum, text) => sum + Math.ceil(text.length / LINE_CHARS), 0),
        figuresNotInArticle: !keepsFigures(all, article)};
};

const results = await mapWithConcurrency(articles, 2, async (a) => {
    const sentences = sentencesOf({content: a.text, blocks: a.blocks});
    const articleText = sentences.map(s => s.text).join(' ');
    const language = reader(a.id);
    const [points, summary] = await Promise.all([
        pick(pointsPrompt(a.title, sentences), 'points', 'points', POINT_WORDS * 4, sentences),
        pick(summaryPrompt(a.title, sentences), 'summary', 'pieces', SUMMARY_WORDS, sentences),
    ]);
    // the summary in the order of the article, […] between two pieces of sentences that do not follow
    summary.kept.sort((x, y) => x.sentence - y.sentence || x.start - y.start);
    const [pointsTr, summaryTr] = await Promise.all([translated(points.kept, language), translated(summary.kept, language)]);
    const pointTexts = pointsTr.translation ?? points.kept.map(shown);
    const summaryParts = summaryTr.translation ?? summary.kept.map(shown);
    const summaryText = summaryParts.map((part, i) => i > 0 && summary.kept[i].sentence > summary.kept[i - 1].sentence + 1 ? `[…] ${part}` : part).join(' ');
    return {
        id: a.id, reader: language, sentences: sentences.length,
        points: pointTexts, pointsOriginal: pointsTr.translation ? points.kept.map(shown) : null,
        pointsFrom: points.kept.map(p => p.sentence), pointsWhole: points.kept.filter(p => p.whole).length,
        pointsRefused: points.refused, pointsRefusedTexts: points.refusedTexts, pointsAskedAgain: points.attempt,
        pointsMeasure: measure(pointTexts, articleText),
        summary: summaryText, summaryOriginal: summaryTr.translation ? summary.kept.map(shown).join(' […] ') : null,
        summaryFrom: summary.kept.map(p => p.sentence), summaryWhole: summary.kept.filter(p => p.whole).length, summaryPieces: summary.kept.length,
        summaryRefused: summary.refused, summaryRefusedTexts: summary.refusedTexts, summaryAskedAgain: summary.attempt,
        summaryMeasure: measure([summaryText], articleText),
        untranslated: [pointsTr, summaryTr].some(t => t.from && t.from !== language && !t.translation),
    };
});
const out = results.map((r, i) => r.status === 'fulfilled' ? r.value : {id: articles[i].id, error: String(r.reason)});
fs.writeFileSync(new URL(`./data/faithful/pieces-${run}.json`, import.meta.url), JSON.stringify(out, null, 1));

const avg = (key, field) => {
    const values = out.map(r => r[key]?.[field]).filter(v => typeof v === 'number');
    return (values.reduce((s, v) => s + v, 0) / values.length).toFixed(1);
};
const sum = (field) => out.reduce((s, r) => s + (r[field] ?? 0), 0);
console.log(`run ${run}: tokens ${JSON.stringify(usage)}, seconds ${JSON.stringify(Object.fromEntries(Object.entries(seconds).map(([k, v]) => [k, Math.round(v)])))}`);
console.log(`points: words ${avg('pointsMeasure', 'words')}, lines ${avg('pointsMeasure', 'lines')} (max ${Math.max(...out.map(r => r.pointsMeasure?.lines ?? 0))}), whole sentences ${sum('pointsWhole')} of ${out.reduce((s, r) => s + (r.points?.length ?? 0), 0)}, refused ${sum('pointsRefused')}, asked again ${sum('pointsAskedAgain')}`);
console.log(`summary: words ${avg('summaryMeasure', 'words')}, lines ${avg('summaryMeasure', 'lines')} (max ${Math.max(...out.map(r => r.summaryMeasure?.lines ?? 0))}), pieces ${sum('summaryPieces')} (${sum('summaryWhole')} whole), refused ${sum('summaryRefused')}, asked again ${sum('summaryAskedAgain')}`);
console.log(`figures not in the article: points ${out.filter(r => r.pointsMeasure?.figuresNotInArticle).map(r => r.id).join(' ') || 'none'}, summary ${out.filter(r => r.summaryMeasure?.figuresNotInArticle).map(r => r.id).join(' ') || 'none'}; untranslated ${out.filter(r => r.untranslated).map(r => r.id).join(' ') || 'none'}`);
for (const r of out) {
    if (r.error) console.log(`${r.id}: ${r.error}`);
    else console.log(`${r.id}: ${r.points.length} points (${r.points.map(words).join('/')}), summary ${r.summaryMeasure.words} words ${r.summaryMeasure.lines} lines${r.pointsRefused + r.summaryRefused ? `, refused ${r.pointsRefused}+${r.summaryRefused}` : ''}`);
}
process.exit(0);
