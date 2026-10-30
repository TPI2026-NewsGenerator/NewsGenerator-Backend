// Writes a briefing for a reader as the briefing page does, and prints its cards with where their
// news came from (the reader's own sources, the shared feeds, Google News). Run inside the API container:
//   docker exec -i newsgenerator-api node --input-type=module - <userId> < this file
import {writeFileSync} from 'node:fs';
import {BriefingService} from '/app/services/briefing-service.js';
import {FeedModel} from '/app/models/feed-model.js';
import {guardFetch} from '/app/services/utils/public-url.js';

guardFetch();
const userId = Number(process.argv[2]);
const started = Date.now();
await BriefingService.start(userId);
let briefing;
for (;;) {
    briefing = await BriefingService.latest(userId);
    if (briefing.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 5000));
}
const own = new Set(await FeedModel.userFeedUrls(userId));
console.log(`${briefing.status} in ${Math.round((Date.now() - started) / 1000)} s${briefing.error ? `: ${briefing.error}` : ''}`);
for (const [i, item] of briefing.items.entries()) {
    const fromOwn = item.feedUrls.filter(url => own.has(url)).length;
    console.log(`\n${i + 1}. ${item.title}\n   interest: ${item.interest} | why: ${item.why}\n   media: ${item.corroboration.mediaNames.join(', ')} | feeds: ${item.feedUrls.length} (${fromOwn} of the reader)`
        + `${item.translation ? ' | translated' : ''}\n   ${(item.summary ?? '').replace(/\s+/g, ' ').slice(0, 220)}`);
}
writeFileSync('/tmp/briefing.json', JSON.stringify(briefing, null, 1));
process.exit(0);
