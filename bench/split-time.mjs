// time of one call of the AI, alone, for the production prompt (P) and one verdict per article (N)
import fs from 'node:fs';
import {ollamaJson, newUsage} from '../services/utils/ollama.js';
import {searchPrompt} from '../services/utils/search-ai.js';
const pools = JSON.parse(fs.readFileSync('bench/data/split/candidates.json', 'utf8'));
const src = fs.readFileSync('bench/split.mjs', 'utf8');
const L = new Function('searchPrompt', `${src.slice(src.indexOf('const L ='), src.indexOf('// L with "close" narrowed'))}; return L;`)(searchPrompt);
const DOUBT = 'Juge chaque article pour lui-même, seulement sur son titre et sa description.';
const N = (q, c) => L(q, c).replace(DOUBT, `${DOUBT} Dans le doute entre "proche" et "non", réponds "non".`);
for (const query of ['les incendies de forêt', 'Taylor Swift', "l'intelligence artificielle à l'hôpital", 'new AI models for programming']) {
    const pool = pools.find(p => p.query === query);
    const R = (q, c) => N(q, c).replace(`Réponds uniquement en JSON, un avis par article, dans l'ordre donné : {"avis": [{"id": "identifiant", "avis": "reponse"}, ...]}`, `Parcours les articles dans l'ordre donné, mais n'écris que ceux qui sont "reponse" ou "proche" : les autres sont "non". Réponds uniquement en JSON : {"avis": [{"id": "identifiant", "avis": "reponse"}, ...]}`);
    for (const [name, prompt] of [['P', searchPrompt], ['R', R]]) {
        const usage = newUsage();
        const t = Date.now();
        await ollamaJson(prompt(query, pool.candidates), usage).catch(e => console.log(e.message));
        console.log(`${query.slice(0, 30).padEnd(30)} ${pool.candidates.length}c ${name} ${((Date.now() - t) / 1000).toFixed(1)} s ${JSON.stringify(usage)}`);
    }
}
process.exit(0);
