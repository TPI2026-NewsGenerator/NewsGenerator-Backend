// the cards of the briefings of a reader read again with their summary: which the AI leaves out
// node bench/review.mjs <userId> <firstBriefingId>
import 'dotenv/config';
import pg from 'pg';
import {reviewCards} from '../services/utils/profile-ai.js';
import {newUsage} from '../services/utils/ollama.js';
const [userId, first] = process.argv.slice(2).map(Number);
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rows: [profile]} = await client.query('SELECT text FROM user_profiles WHERE id_user = $1', [userId]);
const {rows} = await client.query('SELECT id, items FROM briefings WHERE id_user = $1 AND id >= $2 AND status = $3 ORDER BY id', [userId, first, 'ready']);
await client.end();
const usage = newUsage();
let cards = 0;
for (const b of rows) {
    const started = Date.now();
    const refused = await reviewCards(profile.text, b.items.map(item => ({id: String(item.storyId), title: item.title, summary: item.summary})), usage);
    cards += b.items.length;
    console.log(`briefing ${b.id}: ${refused.size} of ${b.items.length} left out, ${Date.now() - started} ms`);
    for (const [id, why] of refused) console.log(`   [${id}] ${b.items.find(i => String(i.storyId) === id).title.slice(0, 70)} -> ${why}`);
}
console.log(`${cards} cards, tokens ${JSON.stringify(usage)}`);
process.exit(0);
