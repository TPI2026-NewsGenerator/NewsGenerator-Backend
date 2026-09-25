//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: server.js
//  Description: Server set up
//

"use strict"

import process from 'node:process'
import 'dotenv/config';
import app from './app.js';
import {FeedService} from './services/feed-service.js';
import {IngestService} from './services/ingest-service.js';

const port = process.env.PORT || 3000;

console.log("Listening on http://localhost:3001");
app.listen(port);

// the categories of the feeds must exist for the custom searches
FeedService.syncCategories().catch(err => console.error(`Categories sync failed: ${err}`));

// the feeds are read, embedded and grouped in background (see IngestService), nobody waits for them.
// INGEST_IN_SERVER=false leaves it to "pnpm run ingest" run by a scheduler of the system
if (process.env.INGEST_IN_SERVER !== 'false') IngestService.schedule();