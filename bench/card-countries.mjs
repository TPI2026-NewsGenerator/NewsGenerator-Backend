// The countries of the cards of the briefings already written, found again by the pipeline of a briefing (namesAndCountriesOfCards),
// the rules of countries.js against the AI choosing among the candidates Wikidata gives (country-choice.js): how many
// cards change, and every card that changes, to be read by hand (the user, 03.11.2026: a wrong country looks unprofessional).
// Read only for the briefings; the names and countries of Wikidata are kept as a briefing keeps them.
//   node --env-file=.env bench/card-countries.mjs [days=14] [max=120]
import process from 'node:process';
import pg from 'pg';
import {namesAndCountriesOfCards} from '../services/utils/card-names.js';
import {countryName} from '../services/utils/country-names.js';
import {newUsage} from '../services/utils/ollama.js';

const [days = 14, max = 120] = process.argv.slice(2).map(Number);
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rows: briefings} = await client.query(`SELECT id, items FROM briefings WHERE status = 'ready' AND created_at > now() - make_interval(days => $1) ORDER BY id DESC`, [days]);

const seen = new Set();
const picked = [];
for (const briefing of briefings) {
    for (const item of briefing.items) {
        if (item.storyId > 0 && !seen.has(item.storyId) && item.articles?.length > 0) {
            seen.add(item.storyId);
            picked.push({briefing: briefing.id, item});
        }
    }
}
// every Nth card: the same sample from one run to the next
const step = Math.max(1, Math.floor(picked.length / max));
const sample = picked.filter((_, i) => i % step === 0).slice(0, max);

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const text = (item) => [item.digest, item.summary, item.points].flat().filter(Boolean).join('\n');
const cards = [];
for (const {item} of sample) {
    const urls = [item.lead?.url, ...item.articles.map(article => article.url)].filter(Boolean);
    const {rows} = await client.query('SELECT id FROM articles WHERE link = ANY($1)', [urls]);
    cards.push({storyId: item.storyId, ids: rows.map(row => row.id), media: item.corroboration?.mediaNames ?? [], topic: item.topic ?? null,
        titles: [...new Set(item.articles.map(article => article.title).filter(Boolean))], text: text(item), language: item.language ?? null,
        sites: urls.map(hostOf)});
}
await client.end();

const usage = newUsage();
const found = new Map();
for (let i = 0; i < cards.length; i += 25) {
    for (const [storyId, card] of await namesAndCountriesOfCards(cards.slice(i, i + 25), {usage})) found.set(storyId, card);
}

const names = (codes) => codes.map(code => countryName(code)).join(', ') || '—';
const same = (a, b) => a.length === b.length && a.every(code => b.includes(code));
const stats = {cards: 0, asked: 0, changed: 0, none: 0, fewer: 0, other: 0};
for (const {briefing, item} of sample) {
    const card = found.get(item.storyId);
    if (!card) continue;
    stats.cards++;
    if (card.candidates.length > 0) stats.asked++;
    if (same(card.countries, card.rules)) continue;
    stats.changed++;
    if (card.countries.length === 0) stats.none++;
    else if (card.countries.every(code => card.rules.includes(code))) stats.fewer++;
    else stats.other++;
    console.log(`\nb${briefing} ${(item.titleTranslation ?? item.title).slice(0, 110)}\n   shown then: ${names(item.countries ?? [])} | rules: ${names(card.rules)} | AI: ${names(card.countries)}\n   candidates: ${card.candidates.map(c => `${c.code} ${c.via.map(v => v.name + (v.media ? ' [media]' : v.international ? ' [intl]' : '')).slice(0, 3).join('/')}`).join(' ; ')}`);
}
console.log(`\n${JSON.stringify(stats)} (none: the AI keeps no country, fewer: keeps some of the rules', other: adds or replaces), tokens ${JSON.stringify(usage)}`);
