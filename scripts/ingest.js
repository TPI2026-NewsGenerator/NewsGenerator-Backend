//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: ingest.js
//  Description: One pass of the background work, by hand: read every feed, embed and group the news
//
//  node scripts/ingest.js          (the server does the same every INGEST_INTERVAL_MINUTES)
//

import 'dotenv/config';
import process from 'node:process'
import {IngestService} from '../services/ingest-service.js';
import {guardFetch} from '../services/utils/public-url.js';

guardFetch();

const result = await IngestService.run();
process.exit(result === null ? 1 : 0);
