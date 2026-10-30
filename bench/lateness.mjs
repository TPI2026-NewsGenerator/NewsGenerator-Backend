// How late the news are read: for the news published these 24 hours, the time between their
// publication and their first reading (created_at), and until their vectors (embedded_at).
//   node --env-file=.env bench/lateness.mjs [since ISO date, published after it, default 24 h ago] [until ISO]
// Only the news read at most an hour after 'until': a window just past and one of yesterday compare
import {prisma} from '../config/db.js';

const since = new Date(process.argv[2] ?? Date.now() - 24 * 3600e3);
const until = new Date(process.argv[3] ?? Date.now());
const rows = await prisma.$queryRawUnsafe(`
    WITH n AS (
        SELECT extract(epoch FROM a.created_at - a.published_at) / 60 AS read_min,
               extract(epoch FROM a.embedded_at - a.published_at) / 60 AS embedded_min,
               f.url LIKE 'https://news.google.com/%' AS google
        FROM articles a JOIN feeds f ON f.id = a.id_feed
        WHERE a.published_at > $1::timestamptz AND a.published_at <= $2::timestamptz AND a.published_at <= a.created_at + interval '5 minutes'
          AND a.created_at <= $2::timestamptz + interval '1 hour'
    )
    SELECT google, count(*) AS news,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY read_min) AS read_median,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY read_min) AS read_p90,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY embedded_min) AS embedded_median,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY embedded_min) AS embedded_p90,
           count(*) FILTER (WHERE read_min <= 5) * 100.0 / count(*) AS within_5_pct,
           count(*) FILTER (WHERE read_min <= 20) * 100.0 / count(*) AS within_20_pct,
           count(*) FILTER (WHERE embedded_min <= 10) * 100.0 / count(*) AS embedded_10_pct
    FROM n GROUP BY google`, since, until);
console.table(rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 10) / 10 : Number(v) || v]))));
process.exit(0);
