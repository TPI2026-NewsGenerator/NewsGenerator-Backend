// The rule "the words of the sentence count for their meaning" in the search by sentence: production
// prompt (P) and with the rule (S), on the candidates production reads, each asked RUNS times.
// node --env-file=.env bench/meaning-sense.mjs <userId>   -> bench/data/meaning-sense/report.json
import fs from 'node:fs';
import process from 'node:process';
import {NewsService} from '../services/news-service.js';
import {FeedModel} from '../models/feed-model.js';
import {ollamaJson} from '../services/utils/ollama.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';
import {searchPrompt, normalizeSorting} from '../services/utils/search-ai.js';

process.env.SEARCH_GOOGLE_NEWS = 'off';
const RUNS = Number(process.env.RUNS) || 3;
const PHRASES = [
    ['fr', "les prix de l'immobilier en Suisse"],
    ['fr', "les décisions de l'arbitrage vidéo en Ligue des champions"],
    ['fr', "la hausse des prix de l'énergie"],
    ['fr', 'PSG'],
    ['fr', "l'intelligence artificielle à l'hôpital"],
    ['fr', 'du football mais pas le PSG'],
    ['fr', 'les tensions entre la Chine et Taïwan'],
    ['fr', 'Mbappé blessure'],
    ['fr', 'ce que le pape a dit pendant sa visite en France'],
    ['fr', 'les cartes Pokémon'],
    ['en', 'electric car sales in China'],
    ['en', 'Federal Reserve interest rate decision'],
    ['en', 'wildfires'],
    ['en', 'last ai models for programming'],
    ['en', 'Taylor Swift'],
];
const RULE = 'Les autres articles, qui touchent seulement le même domaine, ne sont dans aucune liste.';
const SENSE = `${RULE} Les mots de sa phrase comptent pour leur sens, pas pour leur forme : un article qui les emploie dans un autre sens, ou seulement dans un nom (d'une récompense, d'un événement, d'une œuvre, d'une organisation), ne la concerne pas.`;
const VARIANTS = {P: searchPrompt, S: (query, candidates) => searchPrompt(query, candidates).replace(RULE, SENSE)};

const userId = Number(process.argv[2]);
const DIR = 'bench/data/meaning-sense';
fs.mkdirSync(DIR, {recursive: true});
const file = `${DIR}/candidates.json`;
let pools = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
if (!pools) {
    pools = [];
    const original = FeedModel.closestArticles;
    for (const [language, query] of PHRASES) {
        let rows = [];
        FeedModel.closestArticles = async (args) => (rows = await original(args));
        await NewsService.getNews({keywords: [query], category: ['world', 'press', 'sport', 'politics', 'economy', 'technology', 'science'],
            userId, language, timeframe: {start: new Date(Date.now() - 7 * 864e5).toISOString()}});
        // one line per story or title, as searchByMeaning gives them to the AI
        const seen = new Map();
        for (const r of rows) {
            const key = r.id_story != null ? `s${r.id_story}` : `t${r.title}`;
            if (!seen.has(key)) seen.set(key, {id: String(r.id), title: r.title, description: (r.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)});
        }
        pools.push({language, query, candidates: [...seen.values()]});
        console.log(`${query}: ${seen.size} candidates`);
    }
    FeedModel.closestArticles = original;
    fs.writeFileSync(file, JSON.stringify(pools, null, 1));
}

const jobs = pools.flatMap(pool => Object.keys(VARIANTS).flatMap(variant => Array.from({length: RUNS}, (_, run) => ({pool, variant, run}))));
const results = (await mapWithConcurrency(jobs, 4, async ({pool, variant, run}) => {
    const answer = await ollamaJson(VARIANTS[variant](pool.query, pool.candidates)).catch(() => null);
    return {query: pool.query, variant, run, ...normalizeSorting(answer, pool.candidates.map(c => c.id))};
})).map(r => r.value).filter(Boolean);
fs.writeFileSync(`${DIR}/answers.json`, JSON.stringify(results, null, 1));

const titleOf = (pool, id) => pool.candidates.find(c => c.id === id)?.title ?? id;
for (const pool of pools) {
    console.log(`\n### ${pool.query}`);
    for (const variant of Object.keys(VARIANTS)) {
        const runs = results.filter(r => r.query === pool.query && r.variant === variant);
        console.log(`${variant}: answers ${runs.map(r => r.answers.length).join('/')}, related ${runs.map(r => r.related.length).join('/')}`);
        runs.forEach(r => console.log(`   first: ${titleOf(pool, r.answers[0] ?? r.related[0] ?? '').slice(0, 90)}`));
    }
    // what one variant answers and the other never does, over all its runs
    const ids = (variant, list) => new Set(results.filter(r => r.query === pool.query && r.variant === variant).flatMap(r => r[list]));
    const pAll = new Set([...ids('P', 'answers'), ...ids('P', 'related')]);
    const sAll = new Set([...ids('S', 'answers'), ...ids('S', 'related')]);
    const lost = [...pAll].filter(id => !sAll.has(id)).map(id => titleOf(pool, id).slice(0, 80));
    const won = [...sAll].filter(id => !pAll.has(id)).map(id => titleOf(pool, id).slice(0, 80));
    if (lost.length) console.log(`   only P: ${lost.join(' | ')}`);
    if (won.length) console.log(`   only S: ${won.join(' | ')}`);
}
process.exit(0);
