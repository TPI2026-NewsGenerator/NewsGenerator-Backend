// A feed in several languages given one (17.10.2026: the news sitemap of Reuters, one feed for its
// English, Spanish, Portuguese, French, German and Italian news, was told Spanish when a reader added
// it, and "FIFA to amend Article 27 of disciplinary code after Balogun case" was stored Spanish). Its
// news read again by the rule of now and by variants, the language given by their address (/latam/
// Spanish, /pt/ /fr/ /de/ /it/, English otherwise); the news of national media (their domain gives the
// language) read the same way, for the variants not to break them. Read only.
//   node --env-file=.env bench/language-mixed-feeds.mjs [perGroup=3000] [days=14]
import process from 'node:process';
import pg from 'pg';
import {rss} from '../db/rss-links.js';
import {franc} from 'franc';
import {languageOf, feedLanguage} from '../services/utils/language.js';
import {languageOfSearch} from '../services/utils/google-news.js';

const PER_GROUP = Number(process.argv[2] ?? 3000);
const DAYS = Number(process.argv[3] ?? 14);
const REUTERS = 'https://www.reuters.com/arc/outboundfeeds/news-sitemap/?outputType=xml';
const REUTERS_PATHS = {latam: 'es', pt: 'pt', fr: 'fr', de: 'de', it: 'it'};
const GROUPS = {
    pt: String.raw`\.pt$|\.com\.br$|^noticiasaominuto\.com$`,
    es: String.raw`\.es$|^marca\.com$|^as\.com$|^mundodeportivo\.com$|\.com\.ar$|\.com\.mx$`,
    it: String.raw`\.it$`,
    fr: String.raw`\.fr$`,
    de: String.raw`\.de$|\.at$`,
    en: String.raw`\.co\.uk$|^theguardian\.com$|^espn\.com$|^nytimes\.com$`,
    nl: String.raw`\.nl$`,
    pl: String.raw`\.pl$`,
    cs: String.raw`\.cz$`,
};
const sharedLanguage = new Map(Object.entries(rss).flatMap(([language, categories]) =>
    Object.values(categories).flat().map(url => [url, language])));

// the short words of language.js
const source = (await import('node:fs')).readFileSync(new URL('../services/utils/language.js', import.meta.url), 'utf8');
const WORDS = eval(`(${source.match(/const WORDS = (\{[\s\S]*?\n\});/)[1]})`);
const SETS = Object.fromEntries(Object.entries(WORDS).map(([l, w]) => [l, new Set(w.split(' '))]));
const FRANC_ONLY = {eng: 'en', fra: 'fr', spa: 'es', ita: 'it', deu: 'de', nld: 'nl', por: 'pt', ces: 'cs', pol: 'pl'};

const hitsOf = (text) => {
    const words = (text ?? '').toLowerCase().match(/[\p{L}]+/gu) ?? [];
    return Object.fromEntries(Object.entries(SETS).map(([l, s]) => [l, words.filter(w => s.has(w)).length]));
};
// the language with the most short words (ties: the order of WORDS), null under 2
const bestOf = (hits) => {
    let best = null, bestHits = 1;
    for (const [l, n] of Object.entries(hits)) if (n > bestHits) [best, bestHits] = [l, n];
    return best;
};
const francOf = (title) => FRANC_ONLY[franc(title, {minLength: 10, only: Object.keys(FRANC_ONLY)})] ?? null;

// variants: (row, fallback) -> language
const VARIANTS = {
    now: (r, fallback) => languageOf(`${r.title} ${r.description ?? ''}`, fallback) ?? 'en',
    'no feed language': (r) => languageOf(`${r.title} ${r.description ?? ''}`) ?? 'en',
    // no feed language, franc among the 9 on the title when the words tell none
    'no feed language + franc': (r) => languageOf(`${r.title} ${r.description ?? ''}`) ?? francOf(r.title) ?? 'en',
    // no feed language, words tied: franc
    'no feed language, ties franc': (r) => {
        const hits = hitsOf(`${r.title} ${r.description ?? ''}`);
        const max = Math.max(...Object.values(hits));
        const tied = Object.keys(hits).filter(l => hits[l] === max);
        if (max >= 2 && tied.length > 1) return tied.includes(francOf(r.title)) ? francOf(r.title) : tied[0];
        return languageOf(`${r.title} ${r.description ?? ''}`) ?? 'en';
    },
    // the language most of its news clearly are in (English for Reuters) as the feed's
    'main language as feed': (r) => languageOf(`${r.title} ${r.description ?? ''}`, 'en') ?? 'en',
    // the title alone told by its words beats the feed by 2
    'title margin 2': (r, fallback) => {
        const now = VARIANTS.now(r, fallback);
        const hits = hitsOf(r.title);
        const best = bestOf(hits);
        return best && best !== now && hits[best] - (hits[now] ?? 0) >= 2 ? best : now;
    },
    // ... and franc on the title says the same
    'title margin 2 + franc': (r, fallback) => {
        const now = VARIANTS.now(r, fallback);
        const hits = hitsOf(r.title);
        const best = bestOf(hits);
        return best && best !== now && hits[best] - (hits[now] ?? 0) >= 2 && francOf(r.title) === best ? best : now;
    },
    'title margin 1 + franc': (r, fallback) => {
        const now = VARIANTS.now(r, fallback);
        const hits = hitsOf(r.title);
        const best = bestOf(hits);
        return best && best !== now && hits[best] - (hits[now] ?? 0) >= 1 && francOf(r.title) === best ? best : now;
    },
};

const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const select = (where) => `SELECT a.title, a.description, a.lang, a.link, f.url AS feed,
        COALESCE((SELECT uf.language FROM user_feeds uf WHERE uf.url = f.url AND uf.language IS NOT NULL LIMIT 1),
                 (SELECT d.language FROM directory_feeds d WHERE d.url = f.url)) AS feed_language
    FROM articles a JOIN feeds f ON f.id = a.id_feed
    WHERE a.created_at > now() - make_interval(days => $1) AND a.embedded_at IS NOT NULL AND ${where}`;

const groups = {};
const reuters = (await c.query(select(`f.url = $2`), [DAYS, REUTERS])).rows;
for (const r of reuters) r.truth = REUTERS_PATHS[new URL(r.link).pathname.split('/')[1]] ?? 'en';
groups.reuters = reuters;
for (const [truth, pattern] of Object.entries(GROUPS)) {
    const {rows} = await c.query(`${select(`a.medium ~ $2`)} ORDER BY random() LIMIT $3`, [DAYS, pattern, PER_GROUP]);
    for (const r of rows) r.truth = truth;
    groups[truth] = rows;
}

const truthCounts = {};
for (const r of reuters) truthCounts[r.truth] = (truthCounts[r.truth] ?? 0) + 1;
console.log(`Reuters ${reuters.length} news in ${DAYS} days, by address:`, truthCounts,
    ` stored right: ${(100 * reuters.filter(r => r.lang === r.truth).length / reuters.length).toFixed(1)}%`);
console.log('variant'.padEnd(24), Object.entries(groups).map(([g, rows]) => `${g}(${rows.length})`.padStart(12)).join(''));
for (const [name, fn] of Object.entries(VARIANTS)) {
    const cells = Object.values(groups).map(rows => {
        const right = rows.filter(r => fn(r, r.feed_language ?? sharedLanguage.get(r.feed) ?? languageOfSearch(r.feed) ?? null) === r.truth).length;
        return `${(100 * right / rows.length).toFixed(1)}%`.padStart(12);
    });
    console.log(name.padEnd(24), cells.join(''));
}
for (const name of ['title margin 2', 'title margin 2 + franc']) {
    const changed = Object.values(groups).filter(rows => rows !== reuters).flat()
        .filter(r => {
            const fallback = r.feed_language ?? sharedLanguage.get(r.feed) ?? languageOfSearch(r.feed) ?? null;
            return VARIANTS[name](r, fallback) !== VARIANTS.now(r, fallback);
        });
    console.log(`\n${name}: ${changed.length} national news changed, ${changed.filter(r => VARIANTS[name](r, r.feed_language ?? sharedLanguage.get(r.feed) ?? languageOfSearch(r.feed) ?? null) === r.truth).length} to their language`);
    for (const r of changed.slice(0, 12)) console.log(`  ${r.truth}: ${r.title.slice(0, 100)}`);
}

// the language feedLanguage gives each feed from its 30 last news, as when a reader adds it
const feeds = (await c.query(`SELECT f.url, array_agg(a.title || ' ' || a.description ORDER BY a.created_at DESC) AS texts
    FROM feeds f JOIN LATERAL (SELECT title, description, created_at FROM articles WHERE id_feed = f.id
        ORDER BY created_at DESC LIMIT 30) a ON true
    WHERE f.url = $1 GROUP BY f.url`, [REUTERS])).rows;
for (const f of feeds) console.log(`\nfeedLanguage of the 30 last news of Reuters: ${feedLanguage(f.texts, f.url)}`);
await c.end();
