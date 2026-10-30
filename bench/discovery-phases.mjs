// The discovery in two steps (Google News, then the press of Media Cloud) run without saving anything:
// when the first sources would be added, when the last, and the feeds of each step. Then the discovery
// as it was (one step, git HEAD copied to bench/_old-discovery.mjs) on the same profile, the answers of
// Media Cloud kept in memory by the first run, to compare the feeds found.
//   node --env-file=.env bench/discovery-phases.mjs [fresh=1] userId...
// fresh=1: as at the signup, the profile has no source yet (its known media are the shared feeds only)
import process from 'node:process';
import fs from 'node:fs/promises';
import {ProfileModel} from '../models/profile-model.js';
import {FeedModel} from '../models/feed-model.js';
import {discover} from '../services/discovery-service.js';
import {discover as discoverBefore} from './_old-discovery.mjs';

const [freshArg, ...users] = process.argv.slice(2);
const fresh = freshArg === '1';
const report = [];
const log = (line) => { console.log(line); report.push(line); };

let saved = [];
ProfileModel.addProfileFeeds = async (userId, feeds) => { saved.push(...feeds); };
ProfileModel.deleteProfileFeeds = async () => 0;
if (fresh) {
    FeedModel.userFeedUrls = async () => [];
    FeedModel.countUserFeeds = async () => 0;
}
const seconds = (since) => Math.round((Date.now() - since) / 1000);
const sites = (feeds) => feeds.map(feed => feed.url).sort();

for (const userId of users.map(Number)) {
    log(`\n=== user ${userId} (${fresh ? 'fresh profile' : 'its sources as they are'})`);
    saved = [];
    let started = Date.now();
    const steps = {};
    const now = await discover(userId, {onFound: async (found, from) => {
        steps[from] = {at: seconds(started), feeds: found};
        log(`  two steps, ${from.padEnd(6)} at ${String(seconds(started)).padStart(4)} s: ${found.length} feeds ${found.map(feed => feed.url).join(' ')}`);
    }});
    const twoSteps = seconds(started);

    saved = [];
    started = Date.now();
    const before = await discoverBefore(userId);
    log(`  one step (Media Cloud cached) at ${String(seconds(started)).padStart(4)} s: ${before.length} feeds ${before.map(feed => feed.url).join(' ')}`);

    const a = new Set(sites(now));
    const b = new Set(sites(before));
    log(`  first sources at ${steps.google?.at} s instead of after the whole discovery (${twoSteps} s); `
        + `same feeds: ${[...a].filter(url => b.has(url)).length}, only two steps: ${[...a].filter(url => !b.has(url)).join(' ') || 'none'}, `
        + `only one step: ${[...b].filter(url => !a.has(url)).join(' ') || 'none'}`);
}
await fs.mkdir('bench/data', {recursive: true});
await fs.writeFile(`bench/data/discovery-phases-${new Date().toISOString().slice(0, 16).replace(/:/g, '')}.txt`, report.join('\n'));
process.exit(0);
