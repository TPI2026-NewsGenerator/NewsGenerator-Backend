// The split of the search by sentence into answers and close ones, on the candidates production gives
// the AI (the last search, with the feed of Google News when it waited for it): the production prompt
// (P), with "every article answering goes in answers" (Q), and one verdict per article (L).
// node --env-file=.env bench/split.mjs <userId> [--fresh]   -> bench/data/split/{candidates,answers}.json
import fs from 'node:fs';
import process from 'node:process';
import {NewsService} from '../services/news-service.js';
import {FeedModel} from '../models/feed-model.js';
import {ollamaJson} from '../services/utils/ollama.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';
import {searchPrompt, normalizeSorting} from '../services/utils/search-ai.js';

const RUNS = Number(process.env.RUNS) || 3;
const PHRASES = [
    ['fr', "l'arbitrage vidéo en Ligue 1"], ['fr', 'les nouveaux modèles de voitures électriques'], ['fr', 'les cartes Pokémon'],
    ['en', 'the Artemis II astronauts of NASA'], ['en', 'Premier League referee decisions'], ['en', "the America's Cup sailing race"],
    ['fr', "le budget de l'État et la réforme des retraites en France"], ['fr', "les prix de l'immobilier en Suisse"], ['fr', 'les vendanges en Valais'],
    ['fr', 'les incendies de forêt'], ['en', 'the interest rate decision of the Federal Reserve'], ['en', 'measles outbreaks'],
    ['en', 'the Swiss chocolate industry'], ['en', 'new AI models for programming'], ['en', 'Taylor Swift'],
    ['fr', 'du football mais pas le PSG'], ['fr', "l'intelligence artificielle à l'hôpital"],
];

const RULE = 'Les autres articles, qui touchent seulement le même domaine, ne sont dans aucune liste.';
const Q = (query, candidates) => searchPrompt(query, candidates).replace(RULE,
    `Tous les articles qui répondent vont dans "answers", même s'ils sont nombreux : un article n'est "related" que quand il lui manque une précision de sa phrase. ${RULE}`);
// one verdict per article, the definitions of production
const L = (query, candidates) => `Un lecteur cherche des nouvelles avec cette phrase : """${query}"""

Voici des articles, chacun avec son identifiant entre crochets :
${candidates.map(c => `[${c.id}] ${c.title}${c.description ? ` — ${c.description}` : ''}`).join('\n')}

Pour chaque article, dis s'il concerne sa recherche :
- "reponse" : il répond à sa phrase, même avec d'autres mots (un synonyme, une partie ou un cas particulier du sujet répondent aussi). Quand sa phrase précise quelque chose (une personne, une organisation, un lieu, une période, un aspect), l'article en parle.
- "proche" : il parle directement du même sujet sans répondre à toute sa phrase (une autre précision, un autre lieu, un autre aspect).
- "non" : il touche seulement le même domaine, ou parle d'autre chose. Les mots de sa phrase comptent pour leur sens, pas pour leur forme : un article qui les emploie dans un autre sens, ou seulement dans un nom (d'une récompense, d'un événement, d'une œuvre, d'une organisation), est "non". Ce que sa phrase exclut est "non", même quand l'article touche le sujet.
Juge chaque article pour lui-même, seulement sur son titre et sa description.
Réponds uniquement en JSON, un avis par article, dans l'ordre donné : {"avis": [{"id": "identifiant", "avis": "reponse"}, ...]}`;
// L with "close" narrowed: the same subject with one precision changed, never only the same field
const M = (query, candidates) => L(query, candidates)
    .replace('- "proche" : il parle directement du même sujet sans répondre à toute sa phrase (une autre précision, un autre lieu, un autre aspect).',
        '- "proche" : il parle du sujet même de sa phrase, mais une de ses précisions change (une autre personne, un autre lieu, une autre période, un autre aspect).')
    .replace(`- "non" : il touche seulement le même domaine, ou parle d'autre chose.`,
        `- "non" : il parle d'autre chose, ou partage seulement le domaine de sa phrase (le même sport, la même science, la même industrie, le même genre de sujet).`);
// L, prudent: in doubt between close and no, no
const DOUBT = 'Juge chaque article pour lui-même, seulement sur son titre et sa description.';
const N = (query, candidates) => L(query, candidates).replace(DOUBT, `${DOUBT} Dans le doute entre "proche" et "non", réponds "non".`);
// N, and an article sharing only the field of the sentence is no
const O = (query, candidates) => N(query, candidates).replace('Ce que sa phrase exclut est "non"',
    'Un article qui partage seulement le domaine de sa phrase (le même sport, la même science, la même industrie) est "non". Ce que sa phrase exclut est "non"');
// L with a fourth verdict for the articles of the same field only, read as no
const D = (query, candidates) => L(query, candidates)
    .replace(`- "non" : il touche seulement le même domaine, ou parle d'autre chose.`,
        `- "domaine" : il partage seulement le domaine de sa phrase (le même sport, la même science, la même industrie, le même genre de sujet), pas son sujet.
- "non" : il parle d'autre chose.`)
    .replace('{"id": "identifiant", "avis": "reponse"}', '{"id": "identifiant", "avis": "reponse"}');
// N, the verdicts written only for the articles concerning the search: the others are "non"
const R = (query, candidates) => N(query, candidates).replace(
    `Réponds uniquement en JSON, un avis par article, dans l'ordre donné : {"avis": [{"id": "identifiant", "avis": "reponse"}, ...]}`,
    `Parcours les articles dans l'ordre donné, mais n'écris que ceux qui sont "reponse" ou "proche" : les autres sont "non". Réponds uniquement en JSON : {"avis": [{"id": "identifiant", "avis": "reponse"}, ...]}`);
const fromVerdicts = (answer, ids) => {
    const verdicts = Array.isArray(answer?.avis) ? answer.avis : [];
    const of = (kind) => verdicts.filter(v => String(v?.avis ?? '').toLowerCase().startsWith(kind)).map(v => String(v.id));
    return normalizeSorting({answers: of('rep'), related: of('pro')}, ids);
};
const VARIANTS = {
    P: {prompt: searchPrompt, read: normalizeSorting},
    Q: {prompt: Q, read: normalizeSorting},
    L: {prompt: L, read: fromVerdicts},
    M: {prompt: M, read: fromVerdicts},
    N: {prompt: N, read: fromVerdicts},
    O: {prompt: O, read: fromVerdicts},
    D: {prompt: D, read: fromVerdicts},
    R: {prompt: R, read: fromVerdicts},
};
for (const variant of Object.keys(VARIANTS)) if (process.env.VARIANTS && !process.env.VARIANTS.split(',').includes(variant)) delete VARIANTS[variant];

const DIR = 'bench/data/split';
fs.mkdirSync(DIR, {recursive: true});
const file = `${DIR}/candidates.json`;
let pools = !process.argv.includes('--fresh') && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
if (!pools) {
    pools = [];
    const original = FeedModel.closestArticles;
    for (const [language, query] of PHRASES) {
        const calls = [];
        FeedModel.closestArticles = async (args) => { const rows = await original(args); calls.push(rows); return rows; };
        await NewsService.getNews({keywords: [query], category: ['world', 'press', 'sport', 'politics', 'economy', 'technology', 'science'],
            userId: Number(process.argv[2]), language, timeframe: {start: new Date(Date.now() - 7 * 864e5).toISOString()}});
        const seen = new Map();
        for (const r of calls.at(-1)) {
            const key = r.id_story != null ? `s${r.id_story}` : `t${r.title}`;
            if (!seen.has(key)) seen.set(key, {id: String(r.id), title: r.title, description: (r.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)});
        }
        pools.push({language, query, searches: calls.length, candidates: [...seen.values()]});
        console.log(`${query}: ${seen.size} candidates${calls.length > 1 ? ' (with Google)' : ''}`);
    }
    FeedModel.closestArticles = original;
    fs.writeFileSync(file, JSON.stringify(pools, null, 1));
    await new Promise(r => setTimeout(r, 20000));
}

if (process.env.ONLY) pools = pools.filter(pool => process.env.ONLY.split('|').some(part => pool.query.includes(part)));
const jobs = pools.flatMap(pool => Object.keys(VARIANTS).flatMap(variant => Array.from({length: RUNS}, (_, run) => ({pool, variant, run}))));
const started = Date.now();
const results = (await mapWithConcurrency(jobs, 4, async ({pool, variant, run}) => {
    const t = Date.now();
    const answer = await ollamaJson(VARIANTS[variant].prompt(pool.query, pool.candidates)).catch(() => null);
    return {query: pool.query, variant, run, seconds: (Date.now() - t) / 1000, failed: answer === null, ...VARIANTS[variant].read(answer, pool.candidates.map(c => c.id))};
})).map(r => r.value).filter(Boolean);
fs.writeFileSync(`${DIR}/answers${process.env.TAG ? `-${process.env.TAG}` : ''}.json`, JSON.stringify(results, null, 1));
console.log(`${results.length} answers in ${Math.round((Date.now() - started) / 1000)} s`);

const jaccard = (a, b) => { const A = new Set(a), B = new Set(b); const inter = [...A].filter(x => B.has(x)).length; return A.size + B.size - inter ? inter / (A.size + B.size - inter) : 1; };
for (const pool of pools) {
    const line = Object.keys(VARIANTS).map(variant => {
        const runs = results.filter(r => r.query === pool.query && r.variant === variant);
        const stable = runs.length > 1 ? (jaccard(runs[0].answers, runs[1].answers) + (runs[2] ? jaccard(runs[1].answers, runs[2].answers) : 0)) / (runs[2] ? 2 : 1) : 1;
        return `${variant} ${runs.map(r => `${r.answers.length}/${r.related.length}`).join(' ')} same ${stable.toFixed(2)} ${(runs.reduce((s, r) => s + r.seconds, 0) / runs.length).toFixed(0)}s${runs.some(r => r.failed) ? ' FAIL' : ''}`;
    }).join(' | ');
    console.log(`${pool.query.slice(0, 32).padEnd(32)} ${pool.candidates.length}c  ${line}`);
}
process.exit(0);
