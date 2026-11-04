// Cards of the last briefings with a thread of 4 stories or more, outside football, to try the affair on other fields
import 'dotenv/config';
import {prisma} from '../../config/db.js';

const rows = await prisma.$queryRawUnsafe(`
    WITH last AS (SELECT id, id_profile, items FROM briefings WHERE status = 'ready' ORDER BY id DESC LIMIT 60),
    cards AS (SELECT l.id AS briefing, l.id_profile, (i.item->>'storyId')::int AS story, i.item->>'title' AS title
              FROM last l, jsonb_array_elements(l.items) AS i(item) WHERE i.item ? 'storyId')
    SELECT DISTINCT ON (s.id_thread) c.briefing, c.id_profile, c.story, c.title, t.n_stories, cardinality(t.media) AS media
    FROM cards c JOIN stories s ON s.id = c.story JOIN threads t ON t.id = s.id_thread
    WHERE t.n_stories BETWEEN 4 AND 40
      AND c.title !~* 'fifa|uefa|football|soccer|fußball|futbol|calcio|league|cup|match|club|coach|var\M|referee|arbitr|player|goal|basket|nba|nhl|tennis|cricket|rugby|f1|grand prix'
    ORDER BY s.id_thread, c.briefing DESC`);
for (const r of rows.sort((a, b) => b.n_stories - a.n_stories).slice(0, 25)) console.log(`s${r.story} p${r.id_profile} stories=${r.n_stories} media=${r.media} | ${String(r.title).slice(0, 100)}`);
await prisma.$disconnect();
