// The cards of the search grouped by the stories of the ingestion (id_story, bge-m3) instead of the
// trigrams of the titles, on real searches: where the two disagree, printed to be judged by hand.
//  T  today: trigram average link 0.25 (0.45 for short titles), see NewsService.groupDuplicates
//  S  stories: one story = one card; the news without a story (older than the 48 h window when they
//     were embedded) grouped by trigrams among themselves only
//  H  hybrid: the trigram pairs, plus every pair of one story at 1, minus the pairs of two different
//     stories: a news without a story can still join a card by its title
//  V  the rules of assign_stories run on the results themselves (bge-m3 titles 0.70, text 0.6 over the
//     other media, same medium only when almost the same with the same figures), newest first: no drift
//     from day to day, no news cut in two by the order of the ingestion, every news embedded has one
// node bench/story-cards.mjs [days]  ->  bench/data/story-cards/diff.json
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';
import Links from '../services/utils/links.js';
import {Filter} from '../services/utils/filter.js';
import {averageLink, unionFind} from '../services/utils/grouping.js';
import {embed, toSparsevec, toVector} from '../services/utils/embedder.js';

const DAYS = Number(process.argv[2] ?? 7);
const OUT = 'bench/data/story-cards';
fs.mkdirSync(OUT, {recursive: true});

const SEARCHES = [
    {lang: 'en', sentence: 'the fighting in Ukraine and the peace talks'},
    {lang: 'en', sentence: 'interest rates decisions of central banks'},
    {lang: 'en', sentence: 'new artificial intelligence models released by big tech companies'},
    {lang: 'en', sentence: 'football transfers and coaches sacked'},
    {lang: 'en', sentence: 'the Ryder Cup'},
    {lang: 'en', sentence: 'climate change and extreme weather'},
    {lang: 'en', words: 'Trump, tariffs'},
    {lang: 'en', words: '"Premier League"'},
    {lang: 'fr', sentence: 'la politique en France et le gouvernement'},
    {lang: 'fr', sentence: 'les prix de l\'énergie'},
    {lang: 'fr', words: 'Macron, Lecornu'},
];

const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const COLS = `a.id, a.link, a.title, a.medium, a.id_story, a.title_figures, COALESCE(a.published_at, a.created_at) AS at`;

const byMeaning = async (feeds, sentence) => {
    const [v] = await embed([sentence]);
    const {rows} = await c.query(`
        WITH cand AS (SELECT ${COLS}, -(a.text_dense <#> $2::vector) + 0.5 * -(a.text_sparse <#> $3::sparsevec) AS score,
                             -(a.text_sparse <#> $3::sparsevec) AS words
                      FROM articles a JOIN feeds f ON f.id = a.id_feed
                      WHERE f.url = ANY($1::text[]) AND a.embedded_at IS NOT NULL
                        AND COALESCE(a.published_at, a.created_at) >= now() - make_interval(days => $4::int))
        SELECT * FROM (SELECT * FROM cand ORDER BY score DESC LIMIT 80) x
        UNION SELECT * FROM (SELECT * FROM cand ORDER BY words DESC LIMIT 30) y
        ORDER BY score DESC`, [feeds, toVector(v.dense), toSparsevec(v.sparse), DAYS]);
    return rows;
};
const byWords = async (feeds, words) => {
    const sql = Filter.keywordsSql(Filter.parse([words]), 3, 'a.search_text');
    const {rows} = await c.query(`SELECT ${COLS} FROM articles a JOIN feeds f ON f.id = a.id_feed
        WHERE f.url = ANY($1::text[]) AND COALESCE(a.published_at, a.created_at) >= now() - make_interval(days => $2::int)
          AND ${sql.sql} ORDER BY at DESC`, [feeds, DAYS, ...sql.params]);
    return rows;
};
const trigramPairs = async (ids) => (await c.query(`
    SELECT a.id AS id_a, b.id AS id_b, similarity(unaccent(a.title), unaccent(b.title)) AS score
    FROM articles a JOIN articles b ON b.id > a.id AND b.id = ANY($1::int[])
    WHERE a.id = ANY($1::int[])
      AND similarity(unaccent(a.title), unaccent(b.title)) >= CASE WHEN least(length(a.title), length(b.title)) < 40 THEN 0.45 ELSE 0.25 END`,
    [ids])).rows.map(p => ({...p, score: Number(p.score)}));

const vectorPairs = async (ids) => new Map((await c.query(`
    SELECT a.id AS id_a, b.id AS id_b,
           -(a.title_dense <#> b.title_dense) - (a.title_sparse <#> b.title_sparse) AS title,
           -(a.text_dense <#> b.text_dense) AS text
    FROM articles a JOIN articles b ON b.id > a.id AND b.id = ANY($1::int[])
    WHERE a.id = ANY($1::int[]) AND a.embedded_at IS NOT NULL AND b.embedded_at IS NOT NULL`, [ids])).rows
    .map(p => [`${p.id_a}:${p.id_b}`, {title: Number(p.title), text: Number(p.text)}]));

// assign_stories in JavaScript, on the given news only
const storyLink = (articles, pairs) => {
    const between = (a, b) => pairs.get(a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`) ?? {title: 0, text: 0};
    const figures = (a) => (a.title_figures ?? []).join(',');
    const groups = [];
    const groupOf = new Map();
    for (const news of [...articles].sort((x, y) => y.at - x.at || x.id - y.id)) {
        let best = groups.find(g => g.some(m => m.medium === news.medium && (m.link === news.link || m.title === news.title)));
        if (!best) {
            let bestScore = 0.70;
            for (const g of groups) {
                const others = g.filter(m => m.medium !== news.medium);
                let score = null;
                if (others.length > 0) {
                    const text = others.reduce((s, m) => s + between(news, m).text, 0) / others.length;
                    if (text >= 0.6) score = others.reduce((s, m) => s + between(news, m).title, 0) / others.length;
                } else if (!g.some(m => figures(m) && figures(news) && figures(m) !== figures(news))) {
                    score = g.reduce((s, m) => s + between(news, m).title, 0) / g.length - 0.5;
                }
                if (score !== null && score >= bestScore) { best = g; bestScore = score; }
            }
        }
        if (!best) { best = []; groups.push(best); }
        best.push(news);
        groupOf.set(news.id, groups.indexOf(best));
    }
    return (id) => groupOf.get(id);
};

const groupsOf = (articles, find) => {
    const g = new Map();
    for (const a of articles) { const k = find(a.id); if (!g.has(k)) g.set(k, []); g.get(k).push(a); }
    return [...g.values()];
};

const METHODS = {
    T: (articles, pairs) => averageLink(articles, pairs, 0.25),
    S: (articles, pairs) => {
        const noStory = articles.filter(a => a.id_story == null);
        const ids = new Set(noStory.map(a => a.id));
        const trigram = averageLink(noStory, pairs.filter(p => ids.has(p.id_a) && ids.has(p.id_b)), 0.25);
        const storyOf = new Map(articles.map(a => [a.id, a.id_story]));
        return (id) => storyOf.get(id) != null ? `s${storyOf.get(id)}` : `t${trigram(id)}`;
    },
    H: (articles, pairs) => {
        const storyOf = new Map(articles.map(a => [a.id, a.id_story]));
        const differ = (p) => storyOf.get(p.id_a) != null && storyOf.get(p.id_b) != null && storyOf.get(p.id_a) !== storyOf.get(p.id_b);
        const same = [];
        for (let i = 0; i < articles.length; i++) for (let j = i + 1; j < articles.length; j++) {
            const [a, b] = [articles[i], articles[j]];
            if (a.id_story != null && a.id_story === b.id_story) same.push({id_a: Math.min(a.id, b.id), id_b: Math.max(a.id, b.id), score: 1});
        }
        const sameKeys = new Set(same.map(p => `${p.id_a}:${p.id_b}`));
        return averageLink(articles, [...pairs.filter(p => !differ(p) && !sameKeys.has(`${p.id_a}:${p.id_b}`)), ...same], 0.25);
    },
};

const media = (cards) => cards.map(card => new Set(card.map(a => a.medium)).size);
const label = (a) => `${a.title.slice(0, 110)}  [${a.medium}${a.id_story == null ? ', no story' : ''}]`;

const diff = [];
const total = {};
for (const search of SEARCHES) {
    const feeds = Links.getCategoriesLinks(Links.categories(search.lang), search.lang);
    const rows = search.sentence ? await byMeaning(feeds, search.sentence) : await byWords(feeds, search.words);
    const articles = [...new Map(rows.map(a => [a.link, a])).values()];
    const pairs = await trigramPairs(articles.map(a => a.id));
    const vectors = await vectorPairs(articles.map(a => a.id));
    const cards = Object.fromEntries(Object.entries(METHODS).map(([m, f]) => [m, groupsOf(articles, f(articles, pairs))]));
    cards.V = groupsOf(articles, storyLink(articles, vectors));
    const withStory = articles.filter(a => a.id_story != null).length;

    const line = Object.entries(cards).map(([m, cs]) => {
        const multi = media(cs).filter(n => n > 1).length;
        const t = (total[m] ??= {cards: 0, multi: 0}); t.cards += cs.length; t.multi += multi;
        return `${m} ${cs.length} cards, ${multi} multi-media, max ${Math.max(...media(cs))}`;
    }).join(' | ');
    console.log(`\n${search.lang} ${search.sentence ?? search.words}: ${articles.length} news, ${Math.round(100 * withStory / articles.length)}% in a story\n  ${line}`);

    // where H or S joins what T keeps apart (cross-media), and where it splits what T joins
    const keyOf = (cs) => new Map(cs.flatMap((card, i) => card.map(a => [a.id, i])));
    for (const [m, base] of [['H', 'T'], ['S', 'T'], ['V', 'T'], ['V', 'S']]) {
        const t = keyOf(cards[base]);
        const o = keyOf(cards[m]);
        for (const [mine, other, what] of [[cards[m], t, `joined by ${m} vs ${base}`], [cards[base], o, `split by ${m} vs ${base}`]]) {
            for (const card of mine) {
                const parts = groupsOf(card, (id) => other.get(id));
                if (parts.length < 2) continue;
                const partMedia = parts.map(p => new Set(p.map(a => a.medium)));
                // only what changes the count of media: parts from different media
                if (parts.every((p, i) => i === 0 || [...partMedia[i]].every(x => partMedia[0].has(x)))) continue;
                diff.push({search: search.sentence ?? search.words, what, parts: parts.map(p => p.map(label))});
            }
        }
    }
}
console.log('\nTOTAL', total);
const counts = {};
for (const d of diff) counts[d.what] = (counts[d.what] ?? 0) + 1;
console.log('differences', counts);
fs.writeFileSync(`${OUT}/diff.json`, JSON.stringify(diff, null, 1));
await c.end();
process.exit(0);
