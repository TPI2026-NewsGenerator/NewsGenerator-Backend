// The official sources of the cards of the last briefings, found by the module of the briefing
// (services/utils/official-sources.js) rather than the bench's copy: what a briefing would show, how
// long it takes, its tokens. Writes the names and channels it reads (party_names, entities), nothing
// of the briefings. Run in the api container, where RSS-Bridge answers. Result: bench/data/official-live.txt
//   node --env-file=.env bench/official-live.mjs [profileIds=7,8,137,242] [briefings=4]
import process from 'node:process';
import fs from 'node:fs';
import pg from 'pg';
import {newUsage} from '../services/utils/ollama.js';
import {officialSourcesOf} from '../services/utils/official-sources.js';

const profileIds = (process.argv[2] ?? '7,8,137,242').split(',').map(Number);
const BRIEFINGS = Number(process.argv[3] ?? 4);
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
const {rows: briefings} = await pool.query(`SELECT id, id_profile, items FROM briefings
    WHERE id_profile = ANY($1) AND status = 'ready' ORDER BY created_at DESC LIMIT $2`, [profileIds, BRIEFINGS]);

const lines = [];
const usage = newUsage();
for (const briefing of briefings) {
    const cards = (briefing.items ?? []).map(item => {
        const dates = (item.articles ?? []).map(article => Date.parse(article.publishedAt)).filter(Number.isFinite);
        return {
            id: item.storyId, title: item.title, titleTranslation: item.titleTranslation ?? null,
            titles: [...new Set((item.articles ?? []).map(article => article.title).filter(t => t && t !== item.title))].slice(0, 4),
            text: String(item.digest ?? item.summary ?? '').slice(0, 700),
            lead: [item.lead?.url, item.lead?.source ? `https://${item.lead.source}` : null].filter(Boolean),
            first: new Date(dates.length ? Math.min(...dates) : Date.now()).toISOString(),
        };
    });
    const started = Date.now();
    const official = await officialSourcesOf(cards, usage);
    const seconds = Math.round((Date.now() - started) / 1000);
    const shown = cards.filter(card => official.get(card.id)?.length);
    lines.push(`\nbriefing ${briefing.id} (profile ${briefing.id_profile}): ${cards.length} cards, ${shown.length} with an official source, ${seconds} s`);
    for (const card of shown) {
        lines.push(`  #${card.id} ${card.title}`);
        for (const post of official.get(card.id)) lines.push(`    ${post.party} (${post.channel}, ${post.publishedAt?.slice(0, 10) ?? '?'}): ${post.title}  <${post.url}>`);
    }
}
lines.push(`\ntokens ${JSON.stringify(usage)}`);
fs.mkdirSync(new URL('./data/', import.meta.url), {recursive: true});
fs.writeFileSync(new URL('./data/official-live.txt', import.meta.url), lines.join('\n') + '\n');
console.log(lines.join('\n'));
await pool.end();
process.exit(0);
