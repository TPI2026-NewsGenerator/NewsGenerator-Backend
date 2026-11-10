// The cards with no country in the briefings already written (friend's point 2, 10.11.2026: "Vietnam, Kenya": an article in Vietnamese, a federation
// of Kenya "written in full", and no country): the pipeline of a briefing run again on a sample of the cards, then the cards that have none, with
// what they would be given by a family name alone linked to a person named in full fewer than 100 times (SURNAME_COUNTRY_SEEN) and by the domain of
// their sites, to be read by hand. Read only. Writes bench/data/country-gaps.json
//   node --env-file=.env bench/country-gaps.mjs [days=21] [max=400]
import process from 'node:process';
import {mkdirSync, writeFileSync} from 'node:fs';
import pg from 'pg';
import {namesAndCountriesOfCards} from '../services/utils/card-names.js';
import {countryName, countryOfSite} from '../services/utils/country-names.js';
import {newUsage} from '../services/utils/ollama.js';

const [days = 21, max = 400] = process.argv.slice(2).map(Number);
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rows: briefings} = await client.query(`SELECT id, id_profile, items FROM briefings WHERE status = 'ready' AND created_at > now() - make_interval(days => $1) ORDER BY id DESC`, [days]);
const seen = new Set();
const picked = [];
for (const briefing of briefings) {
    for (const item of Array.isArray(briefing.items) ? briefing.items : []) {
        if (item.storyId > 0 && !seen.has(item.storyId) && item.articles?.length > 0) {
            seen.add(item.storyId);
            picked.push({briefing: briefing.id, profile: briefing.id_profile, item});
        }
    }
}
const step = Math.max(1, Math.floor(picked.length / max));
const sample = picked.filter((_, i) => i % step === 0).slice(0, max);

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const text = (item) => [item.digest, item.summary, item.points].flat().filter(Boolean).join('\n');
const cards = [];
for (const {item} of sample) {
    const urls = [item.lead?.url, ...item.articles.map(article => article.url)].filter(Boolean);
    const {rows} = await client.query('SELECT id FROM articles WHERE link = ANY($1)', [urls]);
    cards.push({storyId: item.storyId, ids: rows.map(row => row.id), media: item.corroboration?.mediaNames ?? [], topic: item.topic ?? null,
        titles: [...new Set(item.articles.map(article => article.title).filter(Boolean))], title: item.lead?.title ?? item.title, text: text(item), language: item.language ?? null,
        sites: [...new Set(urls.map(hostOf))]});
}
await client.end();

const usage = newUsage();
const found = new Map();
for (let i = 0; i < cards.length; i += 25) {
    for (const [storyId, card] of await namesAndCountriesOfCards(cards.slice(i, i + 25), {usage})) found.set(storyId, card);
}
const out = [];
for (const {briefing, profile, item} of sample) {
    const card = found.get(item.storyId);
    if (!card) continue;
    const given = cards.find(one => one.storyId === item.storyId);
    const tld = new Map();
    for (const site of given.sites) { const code = countryOfSite(site); if (code) tld.set(code, (tld.get(code) ?? 0) + 1); }
    out.push({briefing, profile, storyId: item.storyId, title: item.titleTranslation ?? item.title, language: item.language, shown: item.countries ?? [], countries: card.countries,
        candidates: card.candidates.map(c => c.code), weak: card.weak.map(c => `${c.code}:${c.kind}${c.name ? ' ' + c.name : ''}`), weakKept: card.weakKept, names: card.names.map(n => `${n.name}${n.qid ? '' : '?'}`), sites: given.sites.length, tld: [...tld].map(([code, n]) => `${code}:${n}`),
        text: given.text.replace(/\s+/g, ' ').slice(0, 300)});
}
mkdirSync('bench/data', {recursive: true});
writeFileSync('bench/data/country-gaps.json', JSON.stringify(out, null, 1));
const none = out.filter(card => card.countries.length === 0);
const bucket = (card) => card.candidates.length > 0 ? 'candidates, the AI kept none' : card.names.length === 0 ? 'no name' : 'names, no candidate';
const weakAsked = out.filter(card => card.weak.length > 0);
console.log(`weak candidates asked for ${weakAsked.length} cards, the AI kept a country for ${weakAsked.filter(card => card.weakKept.length > 0).length}`);
for (const card of weakAsked) console.log(`${card.weakKept.length > 0 ? 'KEPT ' + card.weakKept.join(',') : 'none     '} | ${card.weak.join(' ; ')} | [${card.language}] ${card.title.slice(0, 100)}`);
console.log(`${out.length} cards, ${none.length} with no country (${Math.round(100 * none.length / out.length)}%), tokens ${JSON.stringify(usage)}`);
for (const [name, list] of Map.groupBy(none, bucket)) console.log(`  ${name}: ${list.length}`);
