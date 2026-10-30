// Read only: the profile texts of the test accounts and of Enzo, for the funnel bench
//   node --env-file=.env bench/funnel-profiles.mjs
import process from 'node:process';
import fs from 'node:fs';
import {prisma} from '../config/db.js';

const rows = await prisma.$queryRawUnsafe(`
    SELECT id, id_user, name, languages, text, refused FROM user_profiles
    WHERE id_user IN (4, 129, 154, 290, 311, 384, 389, 482) ORDER BY id_user, id`);
fs.writeFileSync(new URL('./data/funnel-profiles.json', import.meta.url), JSON.stringify(rows, null, 1));
for (const row of rows) console.log(`#${row.id} user ${row.id_user} ${row.name} [${row.languages}] ${row.text.length} chars: ${row.text.slice(0, 160).replace(/\s+/g, ' ')}…`);
process.exit(0);
