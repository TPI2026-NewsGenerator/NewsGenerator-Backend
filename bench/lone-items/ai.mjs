//
//  Author: Fabian Rostello
//  Date: 20.10.2026
//  File: ai.mjs
//  Description: The AI (gemma4:31b, the prompt of person-items.js) asked whether the person 5 titles of news
//               name is the one item of Wikidata called so, from its description: adds "ai" (yes, no,
//               unsure) to each person of results.json, and the tokens it took. Read-only on the database
//               node --env-file=.env bench/lone-items/ai.mjs [results-named.json]
//

import fs from 'node:fs';
import pg from 'pg';
import {ollamaJson} from '../../services/utils/ollama.js';
import {lonePrompt} from '../../services/utils/person-items.js';

const TITLES = 5;
const FILE = new URL(`./${process.argv[2] ?? 'results.json'}`, import.meta.url);
const results = JSON.parse(fs.readFileSync(FILE));
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const usage = {calls: 0, input: 0, output: 0};
for (const [i, e] of results.entries()) {
    if (e.ai) continue;
    // as MentionModel.titlesNaming
    const {rows} = await db.query(`
        SELECT title FROM (
            SELECT DISTINCT ON (a.title) a.title, a.id FROM article_mentions am JOIN articles a ON a.id = am.id_article
            WHERE am.id_mention = $1 AND a.title IS NOT NULL ORDER BY a.title, a.id DESC LIMIT 200
        ) t ORDER BY id DESC LIMIT $2`, [e.id, TITLES]);
    const answer = await ollamaJson(lonePrompt(e.name, rows.map(row => row.title), e), usage);
    e.ai = ['yes', 'no', 'unsure'].includes(answer?.same) ? answer.same : 'unsure';
    console.log(`${i + 1}/${results.length} ${e.name}: ${e.ai}`);
    fs.writeFileSync(FILE, JSON.stringify(results, null, 1));
}
await db.end();
console.log(`${usage.calls} calls, ${usage.input} tokens in, ${usage.output} out`);
