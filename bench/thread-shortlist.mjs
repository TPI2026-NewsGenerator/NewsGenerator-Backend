// Read only. The thread each story would join, judged as assign_threads does (every story of its
// language in a thread active THREAD_ACTIVE_DAYS) and judged on a shortlist (the K threads whose
// centroid, the mean of their stories, is closest, then the same exact score on their stories only).
// Same decision? Samples: the stories of the feeds of a user in the last hours, and stories at random.
//   node --env-file=.env bench/thread-shortlist.mjs [userId=482] [perSample=150] [K=20,50]
import {prisma} from '../config/db.js';

const userId = Number(process.argv[2] ?? 482);
const perSample = Number(process.argv[3] ?? 150);
const ks = (process.argv[4] ?? '20,50').split(',').map(Number);
const THRESHOLD = 0.75, MARGIN = 0.10, ACTIVE_DAYS = 7;

const score = (shortlist) => `
    SELECT scored.id_thread, scored.score FROM (
        SELECT pairs.id_thread,
               CASE WHEN bool_or(NOT pairs.shared) THEN AVG(pairs.similarity) FILTER (WHERE NOT pairs.shared)
                    ELSE AVG(pairs.similarity) - ${MARGIN} END AS score
        FROM (
            SELECT o.id_thread, -(o.centroid <#> $1::halfvec) AS similarity, o.media && $2::text[] AS shared
            FROM stories o JOIN threads th ON th.id = o.id_thread
            WHERE o.lang = $3 AND th.updated_at >= now() - make_interval(days => ${ACTIVE_DAYS})
              AND o.centroid IS NOT NULL AND o.id <> $4
              ${shortlist ? `AND o.id_thread IN (SELECT u.id FROM threads u
                    WHERE u.lang = $3 AND u.updated_at >= now() - make_interval(days => ${ACTIVE_DAYS}) AND u.centroid IS NOT NULL
                    ORDER BY u.centroid <#> $1::halfvec LIMIT $5)` : ''}
            OFFSET 0
        ) pairs
        GROUP BY pairs.id_thread
    ) scored
    WHERE scored.score >= ${THRESHOLD}
    ORDER BY scored.score DESC LIMIT 1`;

const pick = (where, params) => prisma.$queryRawUnsafe(`
    SELECT s.id, s.lang, s.centroid::text AS centroid, s.media, s.id_thread,
           (SELECT a.title FROM articles a WHERE a.id_story = s.id ORDER BY a.id LIMIT 1) AS title
    FROM stories s
    WHERE s.centroid IS NOT NULL AND ${where}
    ORDER BY random() LIMIT ${perSample}`, ...params);

const samples = {
    [`user ${userId}`]: await pick(`s.updated_at >= now() - interval '24 hours' AND EXISTS (
        SELECT 1 FROM articles a JOIN feeds f ON f.id = a.id_feed JOIN user_feeds uf ON uf.url = f.url
        WHERE a.id_story = s.id AND uf.id_user = $1)`, [userId]),
    random: await pick(`s.updated_at >= now() - interval '24 hours'`, []),
    // the hard case: in a thread with other stories, one of them sharing a medium with it
    'shared medium': await pick(`s.updated_at >= now() - interval '24 hours' AND EXISTS (
        SELECT 1 FROM stories o WHERE o.id_thread = s.id_thread AND o.id <> s.id AND o.media && s.media)`, []),
    // in a thread with other stories
    joined: await pick(`s.updated_at >= now() - interval '24 hours' AND EXISTS (
        SELECT 1 FROM stories o WHERE o.id_thread = s.id_thread AND o.id <> s.id)`, []),
};

const titleOf = async (thread) => thread == null ? '(new thread)' : (await prisma.$queryRawUnsafe(`
    SELECT a.title FROM stories s JOIN articles a ON a.id_story = s.id WHERE s.id_thread = $1
    ORDER BY a.id DESC LIMIT 1`, thread))[0]?.title;

for (const [name, stories] of Object.entries(samples)) {
    const langs = {};
    for (const s of stories) langs[s.lang] = (langs[s.lang] ?? 0) + 1;
    console.log(`\n== ${name}: ${stories.length} stories ${JSON.stringify(langs)}`);
    const time = {exact: 0}, same = {}, diffs = {};
    let joins = 0;
    for (const k of ks) { time[k] = 0; same[k] = 0; diffs[k] = []; }
    for (const s of stories) {
        const params = [s.centroid, s.media, s.lang, s.id];
        let t = Date.now();
        const [exact] = await prisma.$queryRawUnsafe(score(false), ...params);
        time.exact += Date.now() - t;
        if (exact) joins++;
        for (const k of ks) {
            t = Date.now();
            const [short] = await prisma.$queryRawUnsafe(score(true), ...params, k);
            time[k] += Date.now() - t;
            if ((exact?.id_thread ?? null) === (short?.id_thread ?? null)) same[k]++;
            else diffs[k].push({s, exact, short});
        }
    }
    console.log(`exact: ${Math.round(time.exact / stories.length)} ms a story, ${joins} join a thread`);
    for (const k of ks) {
        console.log(`K=${k}: ${same[k]}/${stories.length} same decision, ${Math.round(time[k] / stories.length)} ms a story`);
        for (const {s, exact, short} of diffs[k]) {
            console.log(`  [${s.lang}] ${s.title}`);
            console.log(`     exact ${exact?.score?.toFixed(3) ?? '-'} -> ${await titleOf(exact?.id_thread)}`);
            console.log(`     short ${short?.score?.toFixed(3) ?? '-'} -> ${await titleOf(short?.id_thread)}`);
        }
    }
}
process.exit(0);
