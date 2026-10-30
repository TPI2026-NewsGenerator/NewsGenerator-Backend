// "les prix de l'immobilier en Suisse" on the candidates of its second search (with the feed of Google
// News): production prompt (P) and with the rule on the meaning of the words (S), RUNS times each
import fs from 'node:fs';
import process from 'node:process';
import {NewsService} from '../services/news-service.js';
import {FeedModel} from '../models/feed-model.js';
import {ollamaJson} from '../services/utils/ollama.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';
import {searchPrompt, normalizeSorting} from '../services/utils/search-ai.js';

const RUNS = Number(process.env.RUNS) || 5;
const [userId, language, query] = [Number(process.argv[2]), process.argv[3] ?? 'fr', process.argv[4] ?? "les prix de l'immobilier en Suisse"];
const RULE = 'Les autres articles, qui touchent seulement le même domaine, ne sont dans aucune liste.';
const SENSE = `${RULE} Les mots de sa phrase comptent pour leur sens, pas pour leur forme : un article qui les emploie dans un autre sens, ou seulement dans un nom (d'une récompense, d'un événement, d'une œuvre, d'une organisation), ne la concerne pas.`;
const NAME = " Les mots de sa phrase comptent pour leur sens, pas pour leur forme : un article qui les emploie dans un autre sens, ou seulement dans un nom (d'une récompense, d'un événement, d'une œuvre, d'une organisation), ne la concerne pas.";
const VARIANTS = {P: searchPrompt, B: (q, c) => searchPrompt(q, c).replace(NAME, "")};

const calls = [];
const original = FeedModel.closestArticles;
FeedModel.closestArticles = async (args) => { const rows = await original(args); calls.push(rows); return rows; };
const result = await NewsService.getNews({keywords: [query], category: ['world', 'press', 'sport', 'politics', 'economy', 'technology', 'science'],
    userId, language, timeframe: {start: new Date(Date.now() - 7 * 864e5).toISOString()}});
const rows = calls.at(-1);
const seen = new Map();
for (const r of rows) {
    const key = r.id_story != null ? `s${r.id_story}` : `t${r.title}`;
    if (!seen.has(key)) seen.set(key, {id: String(r.id), title: r.title, description: (r.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)});
}
const candidates = [...seen.values()];
console.log(`searches ${calls.length}, web ${result.web === true}, ${candidates.length} candidates; production gave first: ${result.news[0]?.title}`);
const jobs = Object.keys(VARIANTS).flatMap(variant => Array.from({length: RUNS}, () => variant));
const out = (await mapWithConcurrency(jobs, 4, async (variant) => ({variant, ...normalizeSorting(await ollamaJson(VARIANTS[variant](query, candidates)).catch(() => null), candidates.map(c => c.id))})))
    .map(r => r.value).filter(Boolean);
const titleOf = (id) => candidates.find(c => c.id === id)?.title ?? '?';
for (const variant of Object.keys(VARIANTS)) {
    console.log(`\n${variant}:`);
    for (const r of out.filter(o => o.variant === variant)) {
        console.log(`  ${r.answers.length} answers, ${r.related.length} related | ${r.answers.slice(0, 3).map(id => titleOf(id).slice(0, 55)).join(' || ')}`);
    }
}
fs.mkdirSync('bench/data/meaning-sense', {recursive: true});
fs.writeFileSync('bench/data/meaning-sense/web.json', JSON.stringify({query, candidates, out}, null, 1));
process.exit(0);
