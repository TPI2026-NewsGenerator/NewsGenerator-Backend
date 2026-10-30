// The input of the analysis bench (What Changed / Why This Matters / What Breaks Next): 10 past
// briefings of different profiles, read only, written to data/analysis/briefings.json
//   node --env-file=.env bench/analysis-input.mjs
// A card is what the reader sees of it: number, title (and its marked translation), medium, key
// passages (the verbatim sentences, their marked translation when the reader has one). Only briefings
// made after the 28.09 redesign: before it the passages were written by the AI.
// No geopolitics/energy profile exists in the DB (15.10): the single-theme ones are refereeing
// (Roberto), Enzo's UEFA governance + refereeing, football (E), TCG; tech/AI is Fab's; mixed interests
// are profile 2 (French football + gastronomy) and 5 (astronomy + electric cars).
import fs from 'node:fs';
import pg from 'pg';
import {readerLanguage} from '../services/utils/language.js';

const BRIEFINGS = [
    {id: 99, kind: 'single theme: refereeing (Roberto)'},
    {id: 90, kind: 'single theme: refereeing (Roberto)'},
    {id: 100, kind: 'football governance + refereeing (Enzo)'},
    {id: 94, kind: 'football governance + refereeing (Enzo)'},
    {id: 92, kind: 'football leagues, transfers, Ronaldo (E)'},
    {id: 70, kind: 'tech: low-level code, AI for coding, tech news (Fab)'},
    {id: 59, kind: 'tech: low-level code, AI for coding, tech news (Fab)'},
    {id: 29, kind: 'single theme: Pokémon TCG'},
    {id: 34, kind: 'mixed: astronomy + electric cars'},
    {id: 31, kind: 'mixed: French football + gastronomy'},
];

const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const out = [];
for (const {id, kind} of BRIEFINGS) {
    const {rows: [b]} = await client.query(`select b.id, b.id_profile, b.created_at, b.hours, b.items, p.name, p.text, p.languages
        from briefings b join user_profiles p on p.id = b.id_profile where b.id = $1`, [id]);
    const language = readerLanguage({text: b.text, languages: b.languages});
    const cards = b.items.filter(item => item.summary).map((item, i) => ({
        n: i + 1,
        title: item.title,
        titleTranslation: item.titleTranslation ?? null,
        medium: item.lead?.source ?? item.articles?.[0]?.source ?? null,
        media: item.corroboration?.media ?? null,
        language: item.language ?? null,
        passages: item.summary,
        translation: item.translation ?? null,
        interest: item.interest ?? null,
    }));
    out.push({id: b.id, profile: b.id_profile, name: b.name, kind, language, createdAt: b.created_at, hours: b.hours, cards});
    console.log(`${id} ${b.name} ${language} ${cards.length}/${b.items.length} cards, ${new Set(cards.map(c => c.interest)).size} interests`);
}
await client.end();
fs.mkdirSync(new URL('./data/analysis/', import.meta.url), {recursive: true});
fs.writeFileSync(new URL('./data/analysis/briefings.json', import.meta.url), JSON.stringify(out, null, 1));
