// the profile and the interests of users: node bench/interests.mjs <username...>
import 'dotenv/config';
import pg from 'pg';
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
for (const username of process.argv.slice(2)) {
    const {rows: [u]} = await client.query(`SELECT u.id, up.text, up.languages, up.topics FROM users u JOIN user_profiles up ON up.id_user = u.id WHERE u.username = $1`, [username]);
    if (!u) { console.log(username, 'no profile'); continue; }
    console.log(`\n== ${username} (id ${u.id}) ${u.languages} ${u.topics ?? ''}\n"""${u.text}"""`);
    const {rows} = await client.query(`SELECT id, weight, text, keywords FROM profile_interests WHERE id_user = $1 ORDER BY id`, [u.id]);
    rows.forEach(r => console.log(`  [${r.id}] w${r.weight} ${r.text}\n     kw: ${r.keywords}`));
}
await client.end();
