// How often the AI does not answer the sorting of a search in JSON, and how long its answer is, on the
// candidates of the search reading every language: each sentence asked RUNS times, one try each.
//   SEARCH_GOOGLE_NEWS=off node --env-file=.env bench/sort-json.mjs <userId>
import process from 'node:process';
import {NewsService} from '../services/news-service.js';
import {FeedModel} from '../models/feed-model.js';
import {FeedService} from '../services/feed-service.js';
import {ollamaJson} from '../services/utils/ollama.js';
import {searchPrompt} from '../services/utils/search-ai.js';

const userId = Number(process.argv[2]);
const RUNS = Number(process.env.RUNS) || 4;
const SEARCHES = [
    ['fr', "les décisions d'arbitrage et la VAR en Ligue des champions"],
    ['fr', "les désignations d'arbitres"],
    ['en', 'Taylor Swift'],
    ['fr', "la hausse des prix de l'énergie"],
];
const original = FeedModel.closestArticles;
for (const [language, sentence] of SEARCHES) {
    let rows = [];
    FeedModel.closestArticles = async (args) => (rows = await original(args));
    const sortAi = await import('../services/utils/search-ai.js');
    await NewsService.getNews({keywords: [sentence], category: FeedService.categories(language), userId, language,
        timeframe: {start: new Date(Date.now() - 7 * 864e5)}}).catch(() => null);
    const seen = new Map();
    for (const r of rows) {
        const key = r.id_story != null ? `s${r.id_story}` : `t${r.title}`;
        if (!seen.has(key)) seen.set(key, {id: String(r.id), title: r.title, description: (r.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)});
    }
    const prompt = searchPrompt(sentence, [...seen.values()]);
    const results = [];
    for (let run = 0; run < RUNS; run++) {
        const started = Date.now();
        const usage = {calls: 0, input: 0, output: 0};
        const answer = await ollamaJson(prompt, usage).then(a => `ok ${a?.avis?.length ?? '?'} verdicts`).catch(err => `failed: ${err.message}`);
        results.push(`${answer} (${((Date.now() - started) / 1000).toFixed(1)} s, ${JSON.stringify(usage)})`);
    }
    console.log(`\n${sentence}: ${seen.size} read, prompt ${prompt.length} chars\n  ${results.join('\n  ')}`);
    void sortAi;
}
process.exit(0);
