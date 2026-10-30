// one batch of the grouping, under the lock of the ingestion, timed: node --env-file=.env bench/group-batch.mjs [maxNews=300]
import pg from 'pg';
import {StoryModel} from '../models/story-model.js';
import {threadPending, WINDOW_HOURS} from '../services/ingest-service.js';
const max = Number(process.argv[2]) || 300;
const lock = new pg.Client({connectionString: process.env.DATABASE_URL});
await lock.connect();
const {rows: [{locked}]} = await lock.query("SELECT pg_try_advisory_lock(hashtext('newsgenerator-ingest')) AS locked");
if (!locked) { console.log('a run is working'); process.exit(0); }
let t = Date.now();
const done = await StoryModel.assignStories({since: new Date(Date.now() - WINDOW_HOURS * 3600e3), threshold: 0.70, sparseWeight: 1,
    sameMediumMargin: 0.5, textThreshold: 0.6, idleDecay: 0.003, idleGrace: 6, maxNews: max});
console.log(`assign_stories: ${JSON.stringify(done)} in ${Math.round((Date.now() - t) / 1000)} s`);
t = Date.now();
const threads = await threadPending(max);
console.log(`assign_threads: ${JSON.stringify(threads)} in ${Math.round((Date.now() - t) / 1000)} s`);
await lock.query("SELECT pg_advisory_unlock(hashtext('newsgenerator-ingest'))");
await lock.end();
process.exit(0);
