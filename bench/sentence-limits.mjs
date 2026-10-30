// What the limits of extract.js take out of real pages: 12 000 characters, 80 sentences, 4-90 words
// node bench/sentence-limits.mjs [articles] [days]   -> bench/data/sentence-limits.json
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';
import {Crawlers} from '../services/utils/crawlers.js';
import {canSummarize, sentencesOf} from '../services/utils/extract.js';
const [nArticles = 300, days = 3] = process.argv.slice(2).map(Number);
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const {rows} = await c.query(`SELECT COALESCE(resolved_link, link) AS url, medium FROM articles
    WHERE created_at > now() - make_interval(days => $1::int)
      AND (link NOT LIKE 'https://news.google.com/%' OR resolved_link IS NOT NULL) ORDER BY random() LIMIT $2`, [days, nArticles]);
await c.end();

// the cut of extract.js, copied: it is not exported
const segmenter = new Intl.Segmenter('en', {granularity: 'sentence'});
const ABBREVIATION = /(?:^|[\s(])(?:[A-Za-z]|[A-Z][a-z]{1,2}|Mme|Mlle|Mgr|n°|No|vs|etc|(?:[A-Z]\.)+[A-Z])\.\s*$/;
const cut = (text) => {
    const spaced = (text ?? '').replace(/([\p{Ll}\d)»"”’])([.!?])(?=[\p{Lu}«"“])/gu, '$1$2 ');
    const sentences = [];
    for (const {segment} of segmenter.segment(spaced)) {
        const sentence = segment.replace(/\s+/g, ' ').trim();
        if (!sentence) continue;
        const previous = sentences.at(-1);
        if (previous !== undefined && (/^[»”’)\]]|^"(?!\p{L})|^\p{Ll}|^\d+\)/u.test(sentence) || ABBREVIATION.test(previous))) {
            sentences[sentences.length - 1] = `${previous} ${sentence}`;
        } else sentences.push(sentence);
    }
    return sentences;
};
const words = (s) => (s ?? '').split(/\s+/).filter(Boolean).length;

const pages = new Map((await Crawlers.Html(rows.map(r => r.url))).map(p => [p.url, p]));
const out = [];
for (const r of rows) {
    const p = pages.get(r.url);
    if (!p?.content || !canSummarize(p.content)) continue;
    const inBlocks = (p.blocks ?? []).filter(b => b.kind === 'text' || b.kind === 'quote');
    const flat = words(inBlocks.map(b => b.text).join(' ')) < words(p.content) / 2;
    // every sentence of the whole text, no limit
    const all = flat ? cut(p.content) : inBlocks.flatMap(b => cut(b.text));
    const kept = sentencesOf(p).map(s => s.text);
    const keptSet = new Set(kept);
    const short = all.filter(s => words(s) < 4), long = all.filter(s => words(s) > 90);
    const fitting = all.filter(s => words(s) >= 4 && words(s) <= 90);
    const lostToLength = fitting.filter(s => !keptSet.has(s));   // dropped by 12 000 chars / 80 sentences
    out.push({url: r.url, medium: r.medium, flat, chars: p.content.length, words: words(p.content),
        sentences: all.length, kept: kept.length, keptWords: words(kept.join(' ')),
        short: short.length, long: long.length, lostToLength: lostToLength.length,
        lostWords: words(lostToLength.join(' ')), shortSamples: short.slice(0, 6), longSamples: long.slice(0, 2).map(s => s.slice(0, 300)),
        lastKept: kept.at(-1)?.slice(0, 120)});
}
fs.writeFileSync(new URL('./data/sentence-limits.json', import.meta.url), JSON.stringify(out, null, 1));

const n = out.length, pct = (k) => `${k}/${n} (${Math.round(100 * k / n)}%)`;
const q = (arr, f) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(f * (s.length - 1))]; };
console.log(`${rows.length} articles, ${n} read in full`);
console.log(`words per article: median ${q(out.map(o => o.words), .5)}, p90 ${q(out.map(o => o.words), .9)}, max ${q(out.map(o => o.words), 1)}`);
console.log(`cut by 12 000 chars / 80 sentences: ${pct(out.filter(o => o.lostToLength > 0).length)}; words lost in those: median ${q(out.filter(o => o.lostToLength).map(o => o.lostWords), .5) ?? 0}, share of their text ${Math.round(100 * out.filter(o => o.lostToLength).reduce((a, o) => a + o.lostWords, 0) / Math.max(1, out.filter(o => o.lostToLength).reduce((a, o) => a + o.words, 0)))}%`);
console.log(`with sentences < 4 words dropped: ${pct(out.filter(o => o.short).length)}, ${out.reduce((a, o) => a + o.short, 0)} sentences`);
console.log(`with sentences > 90 words dropped: ${pct(out.filter(o => o.long).length)}, ${out.reduce((a, o) => a + o.long, 0)} sentences`);
console.log(`flat text (no blocks): ${pct(out.filter(o => o.flat).length)}`);
