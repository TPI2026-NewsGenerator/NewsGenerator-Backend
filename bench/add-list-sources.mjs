// Adds the sites of a list to the sources of a reader as the import of the profile page does (POST
// /feeds/check, then /feeds/import), run inside the API container so a site read through the bridge
// gets the address of its bridge:
//   docker exec -i newsgenerator-api node --input-type=module - <userId> <category> < this file
// with the addresses in /tmp/addresses.txt. Statuses kept: ready, asleep, bridge (within its room)
import {readFileSync, writeFileSync} from 'node:fs';
import {SourceService} from '/app/services/source-service.js';
import {FeedModel} from '/app/models/feed-model.js';
import {bridgeRoom, MAX_USER_FEEDS} from '/app/services/utils/feed-limits.js';
import {assertPublicUrl, guardFetch, hostOf, isBridgeUrl} from '/app/services/utils/public-url.js';

guardFetch();
const [userId, category = 'sport'] = [Number(process.argv[2]), process.argv[3]];
const sites = readFileSync('/tmp/addresses.txt', 'utf8').trim().split('\n');
const started = Date.now();

const checked = [];
for (let start = 0; start < sites.length; start += 25) {
    checked.push(...await SourceService.checkSites({sites: sites.slice(start, start + 25), userId, language: 'fr'}));
    console.error(`${checked.length}/${sites.length} checked, ${Math.round((Date.now() - started) / 1000)} s`);
}

let count = await FeedModel.countUserFeeds(userId);
let bridge = bridgeRoom(await FeedModel.userFeedUrls(userId));
const added = [];
const refused = [];
const seen = new Set();
for (const site of checked.filter(site => ['ready', 'asleep', 'bridge'].includes(site.status))) {
    if (seen.has(site.feed)) continue;
    seen.add(site.feed);
    if (count >= MAX_USER_FEEDS) {
        refused.push({site: site.site, error: 'limit'});
        continue;
    }
    const fromBridge = isBridgeUrl(site.feed);
    if (fromBridge && bridge <= 0) {
        refused.push({site: site.site, error: 'no bridge room'});
        continue;
    }
    try {
        const url = fromBridge ? site.feed : (await assertPublicUrl(site.feed)).href;
        await FeedModel.addUserFeed({userId, url, site: hostOf(site.site) ?? site.site, category, language: site.language});
        added.push({...site, url});
        count++;
        if (fromBridge) bridge--;
    } catch (err) {
        refused.push({site: site.site, error: err.code === 'P2002' ? 'already added' : err.message});
    }
}

const statuses = checked.reduce((counts, site) => ({...counts, [site.status]: (counts[site.status] ?? 0) + 1}), {});
const languages = added.reduce((counts, site) => ({...counts, [site.language ?? '?']: (counts[site.language ?? '?'] ?? 0) + 1}), {});
writeFileSync('/tmp/added.json', JSON.stringify({checked, added, refused}, null, 1));
console.log(JSON.stringify({seconds: Math.round((Date.now() - started) / 1000), statuses, added: added.length, refused, languages}));
process.exit(0);
