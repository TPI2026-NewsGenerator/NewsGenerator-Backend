// Read only: the statements of their parties the articles of the 163 cards report, as production reads
// them (services/utils/statements.js: the prompt with the rules of the 4 wrong ones of
// bench/official-embeds.mjs, asked twice), on the pages that bench kept (data/official-embeds/pages.json).
// Result: bench/data/official-statements.txt, judged by hand.
//   node --env-file=.env bench/official-statements.mjs
import fs from 'node:fs';
import pg from 'pg';
import {statementsOf} from '../services/utils/statements.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';
import {newUsage} from '../services/utils/ollama.js';

const read = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const parties = read('./data/official-badge/parties.json');
const pages = read('./data/official-embeds/pages.json');
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
const {rows: briefings} = await pool.query(`SELECT items FROM briefings WHERE id_profile = ANY($1) AND status = 'ready'
    AND created_at BETWEEN '2026-10-04' AND '2026-10-13' ORDER BY created_at DESC`, [[7, 8, 137, 242]]);
const cards = new Map();
for (const briefing of briefings) for (const item of briefing.items ?? []) {
    const id = String(item.storyId);
    if (!parties[id] || cards.has(id)) continue;
    const media = new Set();
    const texts = [item.lead, ...(item.articles ?? [])].filter(article => article?.url && pages[article.url]?.content)
        .filter(article => !media.has(article.source) && media.add(article.source)).slice(0, 5)
        .map(article => ({source: article.source, url: article.url, publishedAt: article.publishedAt, page: pages[article.url],
            lead: article.url === item.lead?.url}));
    cards.set(id, {id, title: item.title, titleTranslation: item.titleTranslation ?? null, texts});
}
console.log(`${cards.size} cards read from the database`);
const usage = newUsage();
let done = 0;
const results = await mapWithConcurrency([...cards.values()], 3, async (card) => {
    const found = await statementsOf(card, card.texts, (parties[card.id]?.parties ?? []).map(party => party.name), usage);
    if (++done % 20 === 0) console.log(`${done} cards, ${JSON.stringify(usage)}`);
    return found;
});
const lines = [], json = [];
let shown = 0;
[...cards.values()].forEach((card, i) => {
    const found = results[i].status === 'fulfilled' ? results[i].value : [];
    if (results[i].status !== 'fulfilled') lines.push(`#${card.id} FAILED ${results[i].reason?.message}`);
    if (found.length === 0) return;
    shown++;
    lines.push(`#${card.id} [${parties[card.id].kind}] ${card.title}`);
    for (const statement of found) {
        const lead = statement.url === card.texts[0]?.url;
        lines.push(`  ${statement.by} (${statement.source}${lead ? ', LEAD' : ''}): ${statement.sentence.slice(0, 300)}`);
        json.push({card: card.id, title: card.title, by: statement.by, source: statement.source, lead, sentence: statement.sentence});
    }
});
fs.writeFileSync(new URL('./data/official-statements.json', import.meta.url), JSON.stringify(json, null, 1));
lines.unshift(`${cards.size} cards, ${shown} with a statement; tokens ${JSON.stringify(usage)}`, '');
fs.writeFileSync(new URL('./data/official-statements.txt', import.meta.url), lines.join('\n') + '\n');
console.log(lines.join('\n'));
await pool.end();
process.exit(0);
