// The site of each article given to the AI with its title in the search by sentence: production
// prompt (P) and with the site (W), on the candidates production reads, each asked RUNS times. An
// appointment of referees with no description ("Referee appointments: 3-6 October") was answered to
// "referee appointments for the Champions League" while it came from efl.com, an NFL one from
// footballzebras.com. node --env-file=.env bench/meaning-site.mjs <userId>
//   -> bench/data/meaning-site/{candidates,answers}.json
import fs from 'node:fs';
import process from 'node:process';
import {NewsService} from '../services/news-service.js';
import {FeedModel} from '../models/feed-model.js';
import {FeedService} from '../services/feed-service.js';
import {ollamaJson} from '../services/utils/ollama.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';
import {searchPrompt, normalizeSorting, readVerdicts} from '../services/utils/search-ai.js';
import {sourceOf} from '../services/utils/reading-order.js';

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
    // refereeing
    ['en', 'referee appointments for the Champions League matches this week'],
    ['en', 'referee appointments'],
    ['en', 'VAR controversies in the Premier League'],
    ['fr', "les désignations d'arbitres"],
    ['fr', "l'arbitrage en Ligue 1"],
    ['de', 'Schiedsrichter im Fußball'],
    ['es', 'polémicas arbitrales en LaLiga'],
];
const INTRO = 'Voici des articles, chacun avec son identifiant entre crochets :';
const withSite = (query, candidates) => searchPrompt(query, candidates.map(c => ({...c, title: `(${c.site}) ${c.title}`})))
    .replace(INTRO, 'Voici des articles, chacun avec son identifiant entre crochets et le site qui l\'a publié entre parenthèses :');
const VARIANTS = {P: searchPrompt, W: withSite};

const userId = Number(process.argv[2]);
const DIR = 'bench/data/meaning-site';
fs.mkdirSync(DIR, {recursive: true});
const file = `${DIR}/candidates.json`;
let pools = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
if (!pools) {
    pools = [];
    const original = FeedModel.closestArticles;
    for (const [language, query] of PHRASES) {
        let rows = [];
        FeedModel.closestArticles = async (args) => (rows = await original(args));
        // only the candidates are wanted, the AI of production is not waited for
        await NewsService.getNews({keywords: [query], category: FeedService.categories(language),
            userId, language, timeframe: {start: new Date(Date.now() - 7 * 864e5).toISOString()}}).catch(err => console.log(`${query}: ${err.message ?? err}`));
        const seen = new Map();
        for (const r of rows) {
            const key = r.id_story != null ? `s${r.id_story}` : `t${r.title}`;
            if (!seen.has(key)) seen.set(key, {id: String(r.id), site: sourceOf(r.source_url ?? r.link), title: r.title,
                description: (r.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)});
        }
        pools.push({language, query, candidates: [...seen.values()]});
        console.log(`${query}: ${seen.size} candidates`);
    }
    FeedModel.closestArticles = original;
    fs.writeFileSync(file, JSON.stringify(pools, null, 1));
}

const jobs = pools.flatMap(pool => Object.keys(VARIANTS).flatMap(variant => Array.from({length: RUNS}, (_, run) => ({pool, variant, run}))));
const results = (await mapWithConcurrency(jobs, 4, async ({pool, variant, run}) => {
    const started = Date.now();
    const answer = await ollamaJson(VARIANTS[variant](pool.query, pool.candidates)).catch(() => null);
    return {query: pool.query, variant, run, ms: Date.now() - started, ...readVerdicts(answer, pool.candidates.map(c => c.id))};
})).map(r => r.value).filter(Boolean);
fs.writeFileSync(`${DIR}/answers.json`, JSON.stringify(results, null, 1));

const lineOf = (pool, id) => {
    const c = pool.candidates.find(c => c.id === id);
    return c ? `${c.title.slice(0, 80)} (${c.site})` : id;
};
for (const pool of pools) {
    console.log(`\n### ${pool.query} (${pool.candidates.length})`);
    for (const variant of Object.keys(VARIANTS)) {
        const runs = results.filter(r => r.query === pool.query && r.variant === variant);
        console.log(`${variant}: answers ${runs.map(r => r.answers.length).join('/')}, related ${runs.map(r => r.related.length).join('/')}, ${runs.map(r => (r.ms / 1000).toFixed(1)).join('/')} s`);
    }
    // answered by one variant in most runs and by the other in none
    const count = (variant, list, id) => results.filter(r => r.query === pool.query && r.variant === variant && r[list].includes(id)).length;
    const ids = new Set(results.filter(r => r.query === pool.query).flatMap(r => [...r.answers, ...r.related]));
    for (const id of ids) {
        const p = `${count('P', 'answers', id)}a${count('P', 'related', id)}c`;
        const w = `${count('W', 'answers', id)}a${count('W', 'related', id)}c`;
        if (p !== w) console.log(`   P ${p} W ${w}  ${lineOf(pool, id)}`);
    }
}
process.exit(0);
