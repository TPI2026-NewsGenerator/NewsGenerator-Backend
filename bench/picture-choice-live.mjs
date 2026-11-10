// The choice of the picture of a card by the AI (services/utils/picture-choice.js) run live, on the real pictures and the real model: the cards of
// a briefing never saved (bench/data/enzo-measure-<profile>-<n>-raw.json) or of the last saved ones; twice, to tell whether the AI changes its mind
//   node --env-file=.env bench/picture-choice-live.mjs bench/data/enzo-measure-7-24-raw.json
//   node --env-file=.env bench/picture-choice-live.mjs saved 3        (the cards of the 3 last saved briefings)
import process from 'node:process';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {choosePictures} from '../services/utils/picture-choice.js';
import {newUsage} from '../services/utils/ollama.js';

const [source, count] = process.argv.slice(2);
let items;
if (source === 'saved') {
    const c = new pg.Client({connectionString: process.env.DATABASE_URL});
    await c.connect();
    const {rows} = await c.query(`SELECT items FROM briefings WHERE status = 'ready' ORDER BY id DESC LIMIT $1`, [Number(count ?? 3)]);
    await c.end();
    items = rows.flatMap(row => row.items ?? []);
} else {
    items = JSON.parse(readFileSync(source ?? 'bench/data/enzo-measure-7-24-raw.json', 'utf8'));
}
console.log(`${items.length} cards`);
const runs = [];
for (const run of [1, 2]) {
    const usage = newUsage();
    const started = Date.now();
    const changes = await choosePictures(items, {usage, label: `bench ${run}`});
    runs.push(changes);
    console.log(`run ${run}: ${changes.size} changed in ${Math.round((Date.now() - started) / 1000)} s, tokens ${JSON.stringify(usage)}`);
}
const same = [...runs[0].keys()].filter(id => runs[1].get(id)?.thumbnail === runs[0].get(id).thumbnail).length;
console.log(`changed in both runs, to the same picture: ${same} (run 1 ${runs[0].size}, run 2 ${runs[1].size})`);
