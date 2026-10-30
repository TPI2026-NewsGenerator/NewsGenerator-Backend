// Read only. The stories of the feeds of a user judged for their thread since 'since' (by the server,
// with the shortlist of assign_threads): the thread the full scoring (every story of the language in
// an active thread) would give them now, against the thread they are in. Other stories joined since,
// so a few may differ for that reason only: their titles are printed to judge.
//   node --env-file=.env bench/thread-shortlist-live.mjs <since ISO> [userId=482] [until ISO]
// Run on a time before the shortlist too: the same drift shows with the full scoring
import {prisma} from '../config/db.js';

const since = process.argv[2];
const userId = Number(process.argv[3] ?? 482);
const until = process.argv[4] ?? new Date().toISOString();
const THRESHOLD = 0.75, MARGIN = 0.10, ACTIVE_DAYS = 7;

const stories = await prisma.$queryRawUnsafe(`
    SELECT s.id, s.lang, s.centroid::text AS centroid, s.media, s.id_thread,
           (SELECT a.title FROM articles a WHERE a.id_story = s.id ORDER BY a.id LIMIT 1) AS title,
           (SELECT count(*)::int FROM stories o WHERE o.id_thread = s.id_thread) AS thread_size
    FROM stories s
    WHERE s.threaded_at >= $1::timestamptz AND s.threaded_at < $3::timestamptz AND s.centroid IS NOT NULL AND s.id_thread IS NOT NULL
      AND EXISTS (SELECT 1 FROM articles a JOIN feeds f ON f.id = a.id_feed JOIN user_feeds uf ON uf.url = f.url
                  WHERE a.id_story = s.id AND uf.id_user = $2)`, since, userId, until);

const titleOf = async (thread) => thread == null ? '(alone)' : (await prisma.$queryRawUnsafe(`
    SELECT a.title FROM stories s JOIN articles a ON a.id_story = s.id WHERE s.id_thread = $1
    ORDER BY a.id DESC LIMIT 1`, thread))[0]?.title;

let joined = 0, same = 0, alone = 0, aloneSame = 0;
const diffs = [];
for (const s of stories) {
    // the best thread other than by itself: the stories of its own thread count without it
    const [best] = await prisma.$queryRawUnsafe(`
        SELECT scored.id_thread, scored.score FROM (
            SELECT pairs.id_thread,
                   CASE WHEN bool_or(NOT pairs.shared) THEN AVG(pairs.similarity) FILTER (WHERE NOT pairs.shared)
                        ELSE AVG(pairs.similarity) - ${MARGIN} END AS score
            FROM (
                SELECT o.id_thread, -(o.centroid <#> $1::halfvec) AS similarity, o.media && $2::text[] AS shared
                FROM stories o JOIN threads th ON th.id = o.id_thread
                WHERE o.lang = $3 AND th.updated_at >= now() - make_interval(days => ${ACTIVE_DAYS})
                  AND o.centroid IS NOT NULL AND o.id <> $4
                OFFSET 0
            ) pairs
            GROUP BY pairs.id_thread
        ) scored
        WHERE scored.score >= ${THRESHOLD}
        ORDER BY scored.score DESC LIMIT 1`, s.centroid, s.media, s.lang, s.id);
    if (s.thread_size > 1) {
        joined++;
        if (best?.id_thread === s.id_thread) same++;
        else diffs.push({s, best});
    } else {
        alone++;
        if (!best) aloneSame++;
        else diffs.push({s, best});
    }
}
const langs = {};
for (const s of stories) langs[s.lang] = (langs[s.lang] ?? 0) + 1;
console.log(`${stories.length} stories of user ${userId} judged from ${since} to ${until} ${JSON.stringify(langs)}`);
console.log(`in a thread with others: ${same}/${joined} where the full scoring puts them`);
console.log(`alone in their thread: ${aloneSame}/${alone} with no thread above the threshold for the full scoring`);
for (const {s, best} of diffs) {
    console.log(`  [${s.lang}] ${s.title}`);
    console.log(`     now in (${s.thread_size}): ${await titleOf(s.id_thread)}`);
    console.log(`     full ${best?.score?.toFixed(3) ?? '-'}: ${await titleOf(best?.id_thread)}`);
}
process.exit(0);
