// the vectors of the test reader's news cleared, then embedded again by a run of their feeds only:
// it must take all of them, more than one batch of 300
import 'dotenv/config';
import pg from 'pg';
import {IngestService, searchesOfUser} from '../../services/ingest-service.js';
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rows: feeds} = await client.query(`SELECT url FROM user_feeds WHERE id_user = 129`);
const urls = [...feeds.map(f => f.url), ...await searchesOfUser(129)];
const {rowCount} = await client.query(`
    UPDATE articles a SET embedded_at = NULL FROM feeds f
    WHERE f.id = a.id_feed AND f.url = ANY($1::text[]) AND a.embedded_at IS NOT NULL
      AND COALESCE(a.published_at, a.created_at) >= now() - interval '48 hours'`, [urls]);
await client.end();
console.log(`${urls.length} feeds, ${rowCount} news to embed again`);
console.log(await IngestService.run({urls}));
process.exit(0);
