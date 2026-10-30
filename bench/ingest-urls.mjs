// one run of the ingestion for some feeds only, as the discovery starts it
// node bench/ingest-urls.mjs <url> [url...]
import 'dotenv/config';
import {IngestService} from '../services/ingest-service.js';
console.log(await IngestService.run({urls: process.argv.slice(2)}));
process.exit(0);
