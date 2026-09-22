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

// fill the RSS cache now, then refresh it in background
FeedService.start();