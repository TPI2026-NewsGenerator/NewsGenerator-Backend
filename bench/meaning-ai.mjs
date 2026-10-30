// search by meaning + the AI: candidates by vectors, then gemma keeps the ones answering the sentence.
// node bench/meaning-ai.mjs <lang> [days] -- "phrase" ...
import 'dotenv/config';
import pg from 'pg';
import Links from '../services/utils/links.js';
import {embed, toSparsevec, toVector} from '../services/utils/embedder.js';
import {newUsage, ollamaJson} from '../services/utils/ollama.js';
const [lang = 'fr', days = 7] = process.argv.slice(2, 4);
const phrases = process.argv.slice(process.argv.indexOf('--') + 1);
const BY_MEANING = Number(process.env.BY_MEANING) || 80, BY_WORDS = Number(process.env.BY_WORDS) || 30;
const feeds = Links.getCategoriesLinks(Links.categories(lang), lang);
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const vectors = await embed(phrases);

const prompt = (query, list) => `Un lecteur cherche des nouvelles avec cette phrase : """${query}"""

Voici des articles, chacun avec son identifiant entre crochets :
${list.map(a => `[${a.id}] ${a.title}${a.description ? ` — ${a.description}` : ''}`).join('\n')}

Classe les articles qui concernent sa recherche en deux listes, chacune du plus au moins pertinent :
- "answers" : ceux qui répondent à sa phrase, même avec d'autres mots (un synonyme, une partie ou un cas particulier du sujet répondent aussi). Quand sa phrase précise quelque chose (une personne, une organisation, un lieu, une période, un aspect), l'article en parle.
- "related" : ceux qui parlent directement du même sujet sans répondre à toute sa phrase (une autre précision, un autre lieu, un autre aspect).
Les autres articles, qui touchent seulement le même domaine, ne sont dans aucune liste. Ce que sa phrase exclut n'est dans aucune liste, même quand l'article touche le sujet.
Juge seulement sur le titre et la description.
Réponds uniquement en JSON : {"answers": ["identifiant", ...], "related": ["identifiant", ...]}`;

for (const [i, phrase] of phrases.entries()) {
    const params = [feeds, toVector(vectors[i].dense), toSparsevec(vectors[i].sparse), days];
    const base = `FROM articles a JOIN feeds f ON f.id = a.id_feed WHERE f.url = ANY($1::text[]) AND a.embedded_at IS NOT NULL
        AND COALESCE(a.published_at, a.created_at) >= now() - make_interval(days => $4::int)`;
    const cols = `a.id, a.title, left(regexp_replace(a.description, '<[^>]+>|\\s+', ' ', 'g'), 160) AS description, a.medium`;
    const meaning = (await c.query(`SELECT ${cols}, -(a.text_dense <#> $2::vector) - 0.5 * (a.text_sparse <#> $3::sparsevec) AS score ${base} ORDER BY score DESC LIMIT ${BY_MEANING}`, params)).rows;
    const words = (await c.query(`SELECT ${cols}, -(a.text_sparse <#> $3::sparsevec) AS score ${base} AND $2::text IS NOT NULL ORDER BY score DESC LIMIT ${BY_WORDS}`, params)).rows;
    const seen = new Set(); const list = [];
    for (const a of [...meaning, ...words]) if (!seen.has(a.title)) { seen.add(a.title); list.push(a); }
    const usage = newUsage(); const t = Date.now();
    const answer = await ollamaJson(prompt(phrase, list), usage).catch(() => ollamaJson(prompt(phrase, list), usage));
    const byId = new Map(list.map(a => [String(a.id), a]));
    const pick = (ids) => (Array.isArray(ids) ? ids : []).map(id => byId.get(String(id).replace(/^\[|\]$/g, ''))).filter(Boolean);
    const kept = pick(answer.answers), related = pick(answer.related).filter(a => !kept.includes(a));
    console.log(`
=== ${phrase}: ${kept.length} answers + ${related.length} related of ${list.length}, ${Math.round((Date.now() - t) / 1000)} s, tokens ${usage.input}+${usage.output}`);
    for (const a of kept.slice(0, 12)) console.log(`   ${a.title.slice(0, 110)}  [${a.medium}]`);
    for (const a of related.slice(0, 8)) console.log(`   ~ ${a.title.slice(0, 108)}  [${a.medium}]`);
    const top = meaning.slice(0, 5).filter(a => !kept.includes(a) && !related.includes(a));
    if (top.length) console.log(`  left out of the 5 closest: ${top.map(a => a.title.slice(0, 60)).join(' | ')}`);
}
await c.end();
process.exit(0);
