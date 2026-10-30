// the failures in a row of a feed set by hand, to see when a source is shown not working
// node bench/fail.mjs <url part> <failures>
import 'dotenv/config';
import pg from 'pg';
const [part, failures] = process.argv.slice(2);
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
await client.query(`UPDATE feeds SET failures = $2::int, last_error = CASE WHEN $2::int > 0 THEN 'The operation was aborted due to timeout' END WHERE url LIKE $1`, [`%${part}%`, Number(failures)]);
await client.end();
console.log(`${part}: ${failures} failures in a row`);
