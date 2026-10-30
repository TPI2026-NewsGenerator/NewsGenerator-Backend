// Portuguese news told Spanish, Italian or English (14.10.2026: ~21% of the news of .pt media, a sapo.pt
// card left untranslated and alone in its story). The news of national media (their domain gives the
// language) read again by the rule of now and by variants; read only.
//   node --env-file=.env bench/language-pt.mjs [perGroup=4000]
import process from 'node:process';
import pg from 'pg';
import {rss} from '../db/rss-links.js';
import {franc} from 'franc';
import {languageOf} from '../services/utils/language.js';
import {languageOfSearch} from '../services/utils/google-news.js';

const PER_GROUP = Number(process.argv[2] ?? 4000);
const GROUPS = {
    pt: String.raw`\.pt$|\.com\.br$|^noticiasaominuto\.com$`,
    es: String.raw`\.es$|^marca\.com$|^as\.com$|^mundodeportivo\.com$|^elmundo\.es$|\.com\.ar$|\.com\.mx$`,
    it: String.raw`\.it$`,
    fr: String.raw`\.fr$`,
    de: String.raw`\.de$|\.at$`,
    en: String.raw`\.co\.uk$|^theguardian\.com$|^espn\.com$|^nytimes\.com$`,
    pl: String.raw`\.pl$`,
    cs: String.raw`\.cz$`,
    sk: String.raw`\.sk$`,
};
const sharedLanguage = new Map(Object.entries(rss).flatMap(([language, categories]) =>
    Object.values(categories).flat().map(url => [url, language])));

// the words of language.js, with the variants
const BASE = {
    fr: 'le la les des une un du et est dans pour sur au aux avec par pas qui que ce cette son ses sont plus leur',
    en: 'the a an of and is in for on to with by not who that this his her are more from at as its was',
    es: 'el la los las un una del y es en para con por que se su sus al como más pero',
    it: 'il lo la gli le un una del della di e è in per con che si non al come più sono',
    de: 'der die das den dem des ein eine und ist im in für mit von auf nicht sich zu dass wird bei',
    nl: 'het een van op met voor niet zijn dat aan bij ook naar om wordt werd hun deze nog maar uit',
    pt: 'os um uma dos das em ao não com mais seu sua pelo pela foi são',
    cs: 'že jsou pro jak už jako ale od byl bylo jeho které který také nebo při',
    pl: 'się nie że jest jak po od już dla oraz przez był jego które który także tym',
};
const PT_MORE = 'o do da no na à às é nos nas já após também está muito ele ela num numa'; // 'no' is Spanish too
const PT_MORE_SAFE = 'o do da na à às é nas já após também está muito ela num numa';
const FRANC_CODES = {eng: 'en', fra: 'fr', spa: 'es', ita: 'it', deu: 'de', nld: 'nl', por: 'pt', ces: 'cs', pol: 'pl', glg: 'gl', cat: 'ca'};
const setsOf = (words) => Object.fromEntries(Object.entries(words).map(([l, w]) => [l, new Set(w.split(' '))]));

const wordsLanguage = (sets, text, preferred, margin) => {
    const words = (text ?? '').toLowerCase().match(/[\p{L}]+/gu) ?? [];
    let best = null, bestHits = 1, preferredHits = 0;
    for (const [language, set] of Object.entries(sets)) {
        const hits = words.reduce((count, word) => count + (set.has(word) ? 1 : 0), 0);
        if (language === preferred) preferredHits = hits;
        if (hits > bestHits) [best, bestHits] = [language, hits];
    }
    if (!best) return null;
    // the feed's language kept unless another one beats it by 'margin' hits
    return preferred && sets[preferred] && bestHits - preferredHits < margin ? preferred : best;
};
const variant = (sets, margin) => (text, fallback) => {
    if (fallback && !sets[fallback]) return fallback;
    const words = wordsLanguage(sets, text, fallback, margin);
    if (fallback) return words ?? fallback;
    // no feed language: the groups of letters of a long text, as longTextLanguage
    const trigrams = FRANC_CODES[franc(text, {minLength: 200})] ?? null;
    return trigrams && (!words || !sets[trigrams]) ? trigrams : words;
};
const VARIANTS = {
    now: languageOf,
    'copy (=now)': variant(setsOf(BASE), 1),
    'pt words': variant(setsOf({...BASE, pt: `${BASE.pt} ${PT_MORE_SAFE}`}), 1),
    'pt words+no': variant(setsOf({...BASE, pt: `${BASE.pt} ${PT_MORE}`}), 1),
    'feed margin 2': variant(setsOf(BASE), 2),
    'feed margin 3': variant(setsOf(BASE), 3),
    'pt words + margin 2': variant(setsOf({...BASE, pt: `${BASE.pt} ${PT_MORE_SAFE}`}), 2),
    'pt words no da + margin 2': variant(setsOf({...BASE, pt: `${BASE.pt} ${PT_MORE_SAFE.replace(' da ', ' ')}`}), 2),
    'pt words no o/do/da/na + margin 2': variant(setsOf({...BASE, pt: `${BASE.pt} à às é nas já após também está muito ela num numa`}), 2),
    'pt words no o/do/da/na + margin 3': variant(setsOf({...BASE, pt: `${BASE.pt} à às é nas já após também está muito ela num numa`}), 3),
};

const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const results = {};
for (const [truth, pattern] of Object.entries(GROUPS)) {
    const {rows} = await c.query(`SELECT a.title, a.description, a.lang, f.url AS feed,
            COALESCE((SELECT uf.language FROM user_feeds uf WHERE uf.url = f.url AND uf.language IS NOT NULL LIMIT 1),
                     (SELECT d.language FROM directory_feeds d WHERE d.url = f.url)) AS feed_language
        FROM articles a JOIN feeds f ON f.id = a.id_feed
        WHERE a.created_at > now() - interval '3 days' AND a.medium ~ $1 AND a.embedded_at IS NOT NULL
        ORDER BY random() LIMIT $2`, [pattern, PER_GROUP]);
    results[truth] = {n: rows.length, stored: rows.filter(r => r.lang === truth).length};
    const wrong = {};
    for (const [name, fn] of Object.entries(VARIANTS)) {
        let right = 0, noFeed = 0, noFeedRight = 0;
        for (const r of rows) {
            const fallback = r.feed_language ?? sharedLanguage.get(r.feed) ?? languageOfSearch(r.feed) ?? null;
            const told = fn(`${r.title} ${r.description ?? ''}`, fallback) ?? 'en';
            if (told === truth) right++;
            else if (name === 'pt words no o/do/da/na + margin 2' && (wrong[truth] ??= []).length < 4) wrong[truth].push(`${told}/${fallback}: ${r.title.slice(0, 80)}`);
            if (!fallback) { noFeed++; if (told === truth) noFeedRight++; }
        }
        results[truth][name] = `${(100 * right / rows.length).toFixed(1)}%`;
        if (name === 'now') results[truth]['no feed lang'] = `${noFeed} (${noFeed ? (100 * noFeedRight / noFeed).toFixed(0) : '-'}% right)`;
    }
    for (const line of wrong[truth] ?? []) console.log(`  ${truth} still wrong: ${line}`);
}
await c.end();
for (const name of Object.keys(results.pt).filter(k => !['n', 'stored', 'no feed lang'].includes(k))) {
    console.log(name.padEnd(36), Object.entries(results).map(([group, r]) => `${group} ${r[name]}`).join('  '));
}
