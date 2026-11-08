// What the places a card names (no item of Wikidata yet) would give it: for the cards without a country of the last 40 briefings, the
// places named by a quarter of their articles with no item are given one by the rules of today (a country declined, the title of an article
// of the Wikipedia of their language, the items called so of one country), and their country is read. Writes nothing in the database;
// 8.11.2026: 273 of 795 cards had no country, 49 of them named such a place. Prints the cards that gain a country, to judge by hand
//   node --env-file=.env bench/places-countries.mjs [briefings=40]
import process from 'node:process';
import pg from 'pg';
import {MentionModel} from '../models/mention-model.js';
import {countryDeclined, countryNamed} from '../services/utils/country-names.js';
import {linkedByTitle} from '../services/utils/title-links.js';
import {placeItem, readCountries} from '../services/utils/wikidata.js';

const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const {rows: briefings} = await c.query("SELECT id, items FROM briefings WHERE status = 'ready' AND items IS NOT NULL ORDER BY id DESC LIMIT $1", [Number(process.argv[2] ?? 40)]);
const seen = new Set();
const cards = [];
for (const b of briefings) for (const item of b.items) {
    if (seen.has(item.storyId) || (item.countries ?? []).length > 0) continue;
    seen.add(item.storyId);
    const ids = [item.storyId, ...(item.mergedStoryIds ?? [])];
    const {rows: arts} = await c.query('SELECT id FROM articles WHERE id_story = ANY($1)', [ids]);
    if (!arts.length) continue;
    const least = Math.max(1, Math.ceil(arts.length * 0.25));
    const rows = (await MentionModel.namesOfArticles(arts.map(a => a.id), 3))
        .filter(r => r.kind === 'location' && !r.qid && Math.max(r.inCard, r.itemInCard ?? 0) >= least && !countryNamed(r.name));
    if (rows.length) cards.push({briefing: b.id, story: item.storyId, title: String(item.titleAsPublished ?? item.title).slice(0, 80), rows});
}
await c.end();
const unique = [...new Map(cards.flatMap(card => card.rows).map(r => [r.id, r])).values()];
console.log('cards without a country that name a place with no item:', cards.length, '; distinct places:', unique.length);

const via = new Map();
for (const r of unique) { const code = countryDeclined(r.name, r.lang); if (code) via.set(r.id, {how: 'declined', country: code}); }
const rest = unique.filter(r => !via.has(r.id));
const byTitle = await linkedByTitle(rest);
for (const [id, qid] of byTitle) via.set(id, {how: 'title', qid});
for (const r of rest.filter(r => !via.has(r.id))) {
    const qid = await placeItem(r.name, r.lang ?? 'en').catch(() => null);
    if (qid) via.set(r.id, {how: 'search', qid});
}
const qids = [...new Set([...via.values()].map(v => v.qid).filter(Boolean))];
const countries = qids.length ? await readCountries(qids) : new Map();
let gained = 0;
for (const card of cards) {
    const found = card.rows.map(r => ({r, v: via.get(r.id)})).filter(x => x.v).map(({r, v}) => ({name: r.name, how: v.how, country: v.country ?? countries.get(v.qid)?.country ?? null})).filter(x => x.country);
    if (!found.length) continue;
    gained++;
    console.log(`${card.briefing}/${card.story} ${found.map(f => `${f.name}[${f.how}]>${f.country}`).join(' ')} :: ${card.title}`);
}
console.log('cards that gain a country:', gained, 'of', cards.length);
process.exit(0);
