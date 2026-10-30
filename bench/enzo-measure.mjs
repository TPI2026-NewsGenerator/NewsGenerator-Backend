// An unsaved briefing of a profile (write(null, ...), nothing becomes "shown") with everything needed to
// judge it by hand: the profile, each card with its passages, the news of its story (and merged ones),
// its other angles, Contested and Official source. Writes bench/data/enzo-measure-<profile>-<n>.json
//   node --env-file=.env bench/enzo-measure.mjs [profile=7] [hours=48] [n=1]
import process from 'node:process';
import {writeFileSync, mkdirSync} from 'node:fs';
import pg from 'pg';
import {write} from '../services/briefing-service.js';
import {aiStats} from '../services/utils/ollama.js';

const [profileId, hours, n] = [Number(process.argv[2] ?? 7), Number(process.argv[3] ?? 48), process.argv[4] ?? '1'];
let seconds = '';
const log = console.log;
console.log = (...args) => {
    const line = args.join(' ');
    const found = line.match(/seconds (\{.*\})$/);
    if (line.startsWith('Briefing null: tokens') && found) seconds = found[1];
    log(...args);
};
const started = Date.now();
const items = await write(null, profileId, hours);
const took = Math.round((Date.now() - started) / 1000);
writeFileSync(`bench/data/enzo-measure-${profileId}-${n}-raw.json`, JSON.stringify(items));
console.log = log;

const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const {rows: [profile]} = await c.query('SELECT name, text, refused FROM user_profiles WHERE id = $1', [profileId]);
const {rows: interests} = await c.query('SELECT id, text, weight FROM profile_interests WHERE id_profile = $1 ORDER BY id', [profileId]).catch(() => ({rows: []}));
const membersOf = async (ids) => (await c.query(`SELECT id_story, to_char(COALESCE(published_at, created_at), 'DD HH24:MI') at, medium, lang, left(title, 140) title
    FROM articles WHERE id_story = ANY($1) ORDER BY id_story, 2`, [ids])).rows;
const cards = [];
for (const item of items) {
    const ids = [item.storyId, ...(item.mergedStoryIds ?? [])];
    cards.push({...item, members: await membersOf(ids)});
}
await c.end();
mkdirSync('bench/data', {recursive: true});
const file = `bench/data/enzo-measure-${profileId}-${n}.json`;
writeFileSync(file, JSON.stringify({profileId, hours, took, seconds, aiStats, profile, interests, cards}, null, 1));
console.log(`${took} s, ${items.length} cards, angles ${items.reduce((s, i) => s + (i.angles?.length ?? 0), 0)}, `
    + `contested ${items.filter(i => i.contested?.length).length}, official ${items.filter(i => i.official?.length).length} -> ${file}`);
process.exit(0);
