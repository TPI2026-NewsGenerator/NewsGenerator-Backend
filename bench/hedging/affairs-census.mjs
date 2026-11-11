// The affairs kept in the database and the marks of their events (reported, official, denial): how many, and how many events hold each mark.
// Read only.   node --env-file=.env bench/hedging/affairs-census.mjs
import process from 'node:process';
import {prisma} from '../../config/db.js';

const rows = await prisma.$queryRawUnsafe(`SELECT id, id_user, title, language, created_at, jsonb_typeof(view->'events') AS kind,
    jsonb_array_length(COALESCE(view->'events', '[]'::jsonb)) AS events, array_length(story_ids, 1) AS stories FROM affairs ORDER BY id`);
console.log(`${rows.length} affairs`);
for (const row of rows) console.log(`  #${row.id} user ${row.id_user} ${row.language} events ${row.events} stories ${row.stories} ${String(row.created_at).slice(0, 10)} ${String(row.title).slice(0, 70)}`);
const [marks] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS events,
    count(*) FILTER (WHERE e->>'reported' IS NOT NULL)::int AS reported, count(*) FILTER (WHERE (e->>'official')::boolean)::int AS official,
    count(*) FILTER (WHERE (e->>'denial')::boolean)::int AS denial, count(*) FILTER (WHERE e->>'kind' = 'key')::int AS key
    FROM affairs a, jsonb_array_elements(a.view->'events') AS e`);
console.log(JSON.stringify(marks));
const [one] = await prisma.$queryRawUnsafe(`SELECT jsonb_pretty(a.view->'events'->0) AS event FROM affairs a WHERE jsonb_array_length(a.view->'events') > 0 LIMIT 1`);
console.log(one?.event?.slice(0, 1500));
await prisma.$disconnect();
