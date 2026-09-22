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

const port = process.env.PORT || 3000;

console.log("Listening on http://localhost:3001");
app.listen(port);

// the categories of the feeds must exist for the custom searches, the feeds themselves are
// fetched when a search needs them (see FeedService.ensureFresh)
FeedService.syncCategories().catch(err => console.error(`Categories sync failed: ${err}`));