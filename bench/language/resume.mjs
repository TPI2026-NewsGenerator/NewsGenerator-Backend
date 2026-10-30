// the summary of the article of the first card of a briefing, written again with ollamaResume
import 'dotenv/config';
import pg from 'pg';
import {Crawlers} from '../../services/utils/crawlers.js';
import {newUsage, ollamaResume} from '../../services/utils/ollama.js';
import {strayWords} from '../../services/utils/language.js';
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rows: [{item}]} = await client.query(`SELECT items->$2::int AS item FROM briefings WHERE id = $1`, [Number(process.argv[2]), Number(process.argv[3] ?? 0)]);
await client.end();
const link = item.articles?.[0]?.link ?? item.articles?.[0]?.url;
const [page] = await Crawlers.Html([link]);
for (let i = 0; i < 3; i++) {
    const usage = newUsage();
    const {summary} = await ollamaResume(item.title, page.content, {language: 'French', usage});
    console.log(`calls ${usage.calls}, stray ${JSON.stringify(strayWords(summary, 'French'))}\n${summary}\n`);
}
process.exit(0);
