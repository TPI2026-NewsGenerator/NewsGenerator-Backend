// Read only: how long a story waits for its second medium. Stories started 3 to 2 days ago (so each had
// two days to be told again): the share told by a second medium, and the time from the first news seen
// to the first one of another medium. Answers what "wait for 2 sources" would cost a reader.
//   node --env-file=.env bench/second-medium-delay.mjs
import {prisma} from '../config/db.js';

const [row] = await prisma.$queryRawUnsafe(`
    WITH firsts AS (
        SELECT id_story, medium, min(created_at) AS seen
        FROM articles
        WHERE id_story IS NOT NULL AND medium IS NOT NULL AND created_at > now() - interval '5 days'
        GROUP BY id_story, medium
    ), ranked AS (
        SELECT id_story, seen, row_number() OVER (PARTITION BY id_story ORDER BY seen) AS n
        FROM firsts
    ), stories AS (
        SELECT id_story,
               max(seen) FILTER (WHERE n = 1) AS first,
               max(seen) FILTER (WHERE n = 2) AS second
        FROM ranked WHERE n <= 2 GROUP BY id_story
    )
    SELECT count(*)::int AS stories,
           count(second)::int AS told_twice,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM second - first) / 60)
               FILTER (WHERE second IS NOT NULL) AS median_min,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY extract(epoch FROM second - first) / 60)
               FILTER (WHERE second IS NOT NULL) AS p75_min,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM second - first) / 60)
               FILTER (WHERE second IS NOT NULL) AS p90_min,
           count(*) FILTER (WHERE second - first <= interval '1 hour')::int AS within_1h,
           count(*) FILTER (WHERE second - first <= interval '6 hours')::int AS within_6h
    FROM stories
    WHERE first BETWEEN now() - interval '3 days' AND now() - interval '2 days'`);
console.log(row);
await prisma.$disconnect();
