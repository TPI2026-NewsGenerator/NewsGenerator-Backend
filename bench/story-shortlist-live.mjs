// Read only. The news of the feeds of a user grouped by the server between 'since' and 'until': the
// story the full scoring (every grouped news of its language in the window, without itself) gives
// them now, against the story they are in (a story started by the news: none above the threshold).
// News grouped since moved the stories a little, so run it on a time before a change too.
//   node --env-file=.env bench/story-shortlist-live.mjs <since ISO> <until ISO> [userId=482]
import {prisma} from '../config/db.js';

const [since, until] = process.argv.slice(2, 4);
const userId = Number(process.argv[4] ?? 482);
// as services/ingest-service.js
const WINDOW_HOURS = 48, THRESHOLD = 0.70, SPARSE_WEIGHT = 1, SAME_MEDIUM_MARGIN = 0.5, TEXT_THRESHOLD = 0.6;
const IDLE_DECAY = 0.003, IDLE_GRACE = 6;

const score = (shortlist) => `
    SELECT scored.id_story, scored.score FROM (
        SELECT pairs.id_story,
               CASE
                   WHEN bool_or(NOT pairs.same_medium) THEN
                       CASE WHEN AVG(pairs.text_similarity) FILTER (WHERE NOT pairs.same_medium) >= ${TEXT_THRESHOLD}
                            THEN AVG(pairs.similarity) FILTER (WHERE NOT pairs.same_medium) END
                   WHEN NOT bool_or(pairs.other_figures) THEN AVG(pairs.similarity) - ${SAME_MEDIUM_MARGIN}
               END
               - ${IDLE_DECAY} * GREATEST(0, EXTRACT(EPOCH FROM $7::timestamptz - MAX(pairs.at)) / 3600 - ${IDLE_GRACE}) AS score
        FROM (
            SELECT m.id_story,
                   -(m.title_dense <#> $1::halfvec) - ${SPARSE_WEIGHT} * (m.title_sparse <#> $2::sparsevec) AS similarity,
                   -(m.text_dense <#> $3::halfvec) AS text_similarity,
                   m.medium IS NOT DISTINCT FROM $5 AS same_medium,
                   COALESCE(m.published_at, m.created_at) AS at,
                   cardinality(m.title_figures) > 0 AND cardinality($6::text[]) > 0 AND m.title_figures <> $6::text[] AS other_figures
            FROM articles m
            WHERE m.id_story IS NOT NULL AND m.lang = $4 AND m.id <> $8
              AND COALESCE(m.published_at, m.created_at) >= now() - make_interval(hours => ${WINDOW_HOURS})
              ${shortlist ? `AND m.id_story = ANY(ARRAY(
                    SELECT s.id FROM stories s
                    WHERE s.lang = $4 AND s.updated_at >= now() - make_interval(hours => ${WINDOW_HOURS}) AND s.centroid IS NOT NULL
                    ORDER BY s.centroid <#> $3::halfvec LIMIT $9))` : ''}
            OFFSET 0
        ) pairs
        GROUP BY pairs.id_story
    ) scored
    WHERE scored.score >= ${THRESHOLD}
    ORDER BY scored.score DESC LIMIT 3`;

const news = await prisma.$queryRawUnsafe(`
    SELECT a.id, a.lang, a.title, a.medium, a.title_figures, a.id_story,
           a.title_dense::text AS td, a.title_sparse::text AS ts, a.text_dense::text AS xd,
           COALESCE(a.published_at, a.created_at) AS at,
           (SELECT min(o.id) FROM articles o WHERE o.id_story = a.id_story) = a.id AS started
    FROM articles a
    WHERE a.id_story IS NOT NULL AND a.text_dense IS NOT NULL
      AND a.id_story IN (SELECT s.id FROM stories s WHERE s.grouped_at >= $1::timestamptz)
      AND a.embedded_at >= $1::timestamptz - interval '10 minutes' AND a.embedded_at < $2::timestamptz
      AND EXISTS (SELECT 1 FROM feeds f JOIN user_feeds uf ON uf.url = f.url WHERE f.id = a.id_feed AND uf.id_user = $3)
    ORDER BY random() LIMIT 400`, since, until, userId);

const titleOf = async (story) => story == null ? '(new story)' : (await prisma.$queryRawUnsafe(
    'SELECT title FROM articles WHERE id_story = $1 ORDER BY id LIMIT 1', story))[0]?.title;
let joined = 0, joinedSame = 0, started = 0, startedSame = 0;
const diffs = [];
for (const n of news) {
    const [best] = await prisma.$queryRawUnsafe(score(false), n.td, n.ts, n.xd, n.lang, n.medium, n.title_figures ?? [], n.at, n.id);
    if (n.started) { started++; if (!best || best.id_story === n.id_story) startedSame++; else diffs.push({n, best}); }
    else { joined++; if (best?.id_story === n.id_story) joinedSame++; else diffs.push({n, best}); }
}
console.log(`${news.length} news of user ${userId} grouped from ${since} to ${until}`);
console.log(`joined a story: ${joinedSame}/${joined} where the full scoring puts them now`);
console.log(`started a story: ${startedSame}/${started} with no other story above the threshold now`);
for (const {n, best} of diffs.slice(0, 15)) {
    console.log(`  [${n.lang}] ${n.title}`);
    console.log(`     in: ${await titleOf(n.id_story)}`);
    console.log(`     full ${best?.score?.toFixed(3) ?? '-'}: ${await titleOf(best?.id_story)}`);
}
process.exit(0);
