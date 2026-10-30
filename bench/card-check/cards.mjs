// The linked names of the cards of the last briefings (as shown to the reader), each with what the card says
// (the titles of its news, the countries of their sites) and what Wikidata says of its item. Writes
// cards.json (one entry per card and linked name, a card once per story). Read only.
// node --env-file=.env bench/card-check/cards.mjs
import fs from 'node:fs';
import pg from 'pg';
import {describeItems} from '../../services/utils/wikidata.js';
import {countriesOfItems} from '../../services/utils/countries.js';
import {countryOfSite} from '../../services/utils/country-names.js';
import {prisma} from '../../config/db.js';

const IDS = [207, 206, 201, 191, 190, 173, 172, 167, 143, 105, 104, 100, 98, 96, 91];
const patient = async (call) => {
    for (let tries = 0; ; tries++) {
        try { return await call(); } catch (err) {
            if (!err.paused || tries > 20) throw err;
            await new Promise(resolve => setTimeout(resolve, (err.retryIn ?? 65000) + 1000));
        }
    }
};
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const {rows} = await db.query(`SELECT id, items FROM briefings WHERE id = ANY($1::int[]) ORDER BY id DESC`, [IDS]);
await db.end();
const seen = new Set();
const entries = [];
for (const b of rows) {
    for (const card of b.items) {
        if (seen.has(card.storyId)) continue;
        seen.add(card.storyId);
        const articles = [card.lead, ...(card.articles ?? [])].filter(Boolean);
        const titles = [...new Set(articles.map(a => a.title))].slice(0, 6);
        const sites = {};
        for (const a of articles) { const c = countryOfSite(a.source ?? ''); if (c) sites[c] = (sites[c] ?? 0) + 1; }
        for (const name of card.names ?? []) {
            if (name.qid) entries.push({briefing: b.id, storyId: card.storyId, language: card.language, titles, sites, topic: card.topic ?? null, others: (card.names ?? []).filter(n => n !== name).map(n => n.name), media: (card.corroboration?.mediaNames ?? []).length, name: name.name, kind: name.kind, qid: name.qid});
        }
    }
}
const qids = [...new Set(entries.map(e => e.qid))];
const items = new Map();
for (let i = 0; i < qids.length; i += 10) {
    for (const item of await patient(() => describeItems(qids.slice(i, i + 10)))) items.set(item.qid, item);
    await new Promise(resolve => setTimeout(resolve, 300));
}
const countries = await countriesOfItems(qids, {background: true});
for (const e of entries) {
    const item = items.get(e.qid);
    Object.assign(e, {label: item?.label, description: item?.description, links: item?.links, human: item?.human,
        itemCountry: countries.get(e.qid)?.country ?? null, international: countries.get(e.qid)?.international ?? false});
}
fs.writeFileSync(new URL('./cards.json', import.meta.url), JSON.stringify(entries, null, 1));
console.log(`${rows.length} briefings, ${seen.size} cards, ${entries.length} linked names, ${qids.length} items`);
await prisma.$disconnect();
