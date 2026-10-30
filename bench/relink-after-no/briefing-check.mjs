// A briefing of the profile PROFILE (7: Enzo's) written with the code of this laptop and NOT saved (write without
// an id, as the benches do): nobody sees it. Prints each card with its why, its names and countries, then the
// whys that spell an acronym out and the names the check sent away, from the log of the run.
// PROFILE=7 HOURS=48 node --env-file=.env bench/relink-after-no/briefing-check.mjs
import fs from 'node:fs';
import {write} from '../../services/briefing-service.js';
import {expansionsIn} from '../why-acronym/scan.mjs';
import {countryName} from '../../services/utils/name-check.js';
import {prisma} from '../../config/db.js';

const lines = [];
for (const method of ['log', 'error']) {
    const original = console[method].bind(console);
    console[method] = (...args) => { lines.push(args.join(' ')); original(...args); };
}
const started = Date.now();
const items = await write(null, Number(process.env.PROFILE ?? 7), Number(process.env.HOURS ?? 48));
console.log(`\n== ${items.length} cards in ${Math.round((Date.now() - started) / 1000)} s`);
for (const [i, item] of items.entries()) {
    console.log(`\n${String(i + 1).padStart(2)}. [${item.language ?? '?'}] ${item.title}`);
    console.log(`    why: ${item.why}`);
    console.log(`    countries: ${(item.countries ?? []).map(countryName).join(', ') || '-'} | names: ${(item.names ?? []).map(name => `${name.name}${name.qid ? '' : ' (no link)'}`).join(', ') || '-'}`);
}
console.log('\n== whys that spell an acronym out:');
for (const item of items) for (const {acronym, spelled} of expansionsIn(item.why)) console.log(`  ${acronym} = ${spelled} | ${item.title.slice(0, 80)}`);
console.log('== the check of the names, from the log:');
for (const line of lines.filter(line => /names of \d+ checked|sent away|no item chosen/.test(line))) console.log(`  ${line}`);
fs.writeFileSync(new URL('./briefing-check.json', import.meta.url), JSON.stringify(items.map(item => ({title: item.title, why: item.why, countries: item.countries, names: item.names})), null, 1));
await prisma.$disconnect();
process.exit(0);
