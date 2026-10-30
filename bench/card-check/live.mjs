// The names of the cards of a briefing (env ID, 207 by default) read again with the check of name-check.js,
// against the ones stored: which links the card check leaves out. Writes nothing in the briefing.
// node --env-file=.env bench/card-check/live.mjs
import pg from 'pg';
import {namesAndCountriesOfCards} from '../../services/utils/card-names.js';
import {newUsage} from '../../services/utils/ollama.js';
import {prisma} from '../../config/db.js';

const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const {rows: [briefing]} = await db.query(`SELECT items FROM briefings WHERE id = $1`, [Number(process.env.ID ?? 207)]);
const cards = [];
for (const card of briefing.items) {
    if (card.storyId < 0) continue;
    const urls = [card.lead, ...(card.articles ?? [])].filter(Boolean).map(article => article.url);
    const {rows} = await db.query(`SELECT id, title, link FROM articles WHERE link = ANY($1::text[])`, [urls]);
    if (rows.length === 0) continue;
    cards.push({storyId: card.storyId, ids: rows.map(r => r.id), media: [], titles: [...new Set(rows.map(r => r.title).filter(Boolean))], sites: rows.map(r => new URL(r.link).hostname.replace(/^www./, '')), stored: card});
}
await db.end();
const usage = newUsage();
const read = await namesAndCountriesOfCards(cards.map(({stored, ...card}) => card), {usage});
for (const card of cards) {
    const now = read.get(card.storyId);
    const before = card.stored.names.filter(name => name.qid);
    const left = before.filter(name => !now.names.some(n => n.qid === name.qid));
    console.log(`${card.storyId} ${card.stored.title.slice(0, 60)} | countries ${JSON.stringify(card.stored.countries)} -> ${JSON.stringify(now.countries)}${left.length ? ` | links left out: ${left.map(n => n.name).join(', ')}` : ''}`);
}
console.log(JSON.stringify(usage));
await prisma.$disconnect();
