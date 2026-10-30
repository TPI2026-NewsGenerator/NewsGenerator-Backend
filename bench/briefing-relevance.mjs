// A briefing of a reader written live (ranking, AI choice, pages read) and printed, never saved: its
// steps are not recorded and the sources of the profile are not pruned. The cards the reserve brought
// in place of unreadable ones come last (see readable-cards.js), the log line says how many.
//   node --env-file=.env bench/briefing-relevance.mjs [profileId=7] [hours=48] [runs=1] [size=10]  (a profile, see db/add_profiles.sql)
import {write} from '../services/briefing-service.js';
import {BriefingModel} from '../models/briefing-model.js';
import {DiscoveryService} from '../services/discovery-service.js';

const userId = Number(process.argv[2] ?? 7);
const hours = Number(process.argv[3] ?? 48);
const runs = Number(process.argv[4] ?? 1);
const size = Number(process.argv[5] ?? 10);
BriefingModel.step = async () => {};
DiscoveryService.prune = async () => {};

const log = console.log;
for (let run = 1; run <= runs; run++) {
    let replaced = 0;
    console.log = (...args) => {
        const line = args.join(' ');
        const found = line.match(/left out, (\d+) of the reserve/);
        if (found) replaced = Number(found[1]);
        if (/^Briefing/.test(line)) log(line);
    };
    const items = await write(null, userId, hours, size);
    console.log = log;
    log(`\n== run ${run}: ${items.length} cards, the last ${replaced} from the reserve`);
    items.forEach((item, i) => log(`${String(i + 1).padStart(2)} ${i >= items.length - replaced ? 'RESERVE' : '       '} ${item.summary ? '' : '(no passages) '}[${item.lead?.source}] ${item.title}\n      why: ${item.why ?? '-'}`));
}
process.exit(0);
