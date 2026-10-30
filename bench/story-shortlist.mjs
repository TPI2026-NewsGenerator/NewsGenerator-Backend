// Read only. The stories a news would join, scored as assign_stories does (every grouped news of its
// language in the window) and scored on a shortlist (the K stories of the window whose centroid, the
// mean of the texts of their news, is closest to its text, then the same exact score on their news).
// Compared: the first 3 stories above the threshold, in order (assign_stories takes the first one a
// news naming a match does not refuse). The news are already grouped: each is scored without itself.
//   node --env-file=.env bench/story-shortlist.mjs [userId=482] [perSample=150] [K=50,100]
import {prisma} from '../config/db.js';

const userId = Number(process.argv[2] ?? 482);
const perSample = Number(process.argv[3] ?? 150);
const ks = (process.argv[4] ?? '50,100').split(',').map(Number);
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

const pick = (where, params) => prisma.$queryRawUnsafe(`
    SELECT a.id, a.lang, a.title, a.medium, a.title_figures, a.id_story,
           a.title_dense::text AS td, a.title_sparse::text AS ts, a.text_dense::text AS xd,
           COALESCE(a.published_at, a.created_at) AS at
    FROM articles a
    WHERE a.id_story IS NOT NULL AND a.text_dense IS NOT NULL AND a.embedded_at >= now() - interval '6 hours' AND ${where}
    ORDER BY random() LIMIT ${perSample}`, ...params);

const samples = {
    [`user ${userId}`]: await pick(`EXISTS (SELECT 1 FROM feeds f JOIN user_feeds uf ON uf.url = f.url
                                           WHERE f.id = a.id_feed AND uf.id_user = $1)`, [userId]),
    random: await pick('true', []),
    // the hard case: news in a story of several media
    'story of several media': await pick(`EXISTS (SELECT 1 FROM articles o WHERE o.id_story = a.id_story AND o.id <> a.id
                                                    AND o.medium IS DISTINCT FROM a.medium)`, []),
};

const titleOf = async (story) => story == null ? '(new story)' : (await prisma.$queryRawUnsafe(
    'SELECT title FROM articles WHERE id_story = $1 ORDER BY id LIMIT 1', story))[0]?.title;
const key = (rows) => rows.map(row => row.id_story).join(',');

for (const [name, news] of Object.entries(samples)) {
    const langs = {};
    for (const n of news) langs[n.lang] = (langs[n.lang] ?? 0) + 1;
    console.log(`\n== ${name}: ${news.length} news ${JSON.stringify(langs)}`);
    const time = {exact: 0}, same = {}, sameFirst = {}, diffs = {};
    for (const k of ks) { time[k] = 0; same[k] = 0; sameFirst[k] = 0; diffs[k] = []; }
    let joins = 0;
    for (const n of news) {
        const params = [n.td, n.ts, n.xd, n.lang, n.medium, n.title_figures ?? [], n.at, n.id];
        let t = Date.now();
        const exact = await prisma.$queryRawUnsafe(score(false), ...params);
        time.exact += Date.now() - t;
        if (exact.length) joins++;
        for (const k of ks) {
            t = Date.now();
            const short = await prisma.$queryRawUnsafe(score(true), ...params, k);
            time[k] += Date.now() - t;
            if (key(exact) === key(short)) same[k]++;
            if ((exact[0]?.id_story ?? null) === (short[0]?.id_story ?? null)) sameFirst[k]++;
            else diffs[k].push({n, exact, short});
        }
    }
    console.log(`exact: ${Math.round(time.exact / news.length)} ms a news, ${joins} join a story`);
    for (const k of ks) {
        console.log(`K=${k}: first story ${sameFirst[k]}/${news.length} same, first 3 ${same[k]}/${news.length} same, ${Math.round(time[k] / news.length)} ms a news`);
        for (const {n, exact, short} of diffs[k]) {
            console.log(`  [${n.lang}] ${n.title}`);
            console.log(`     exact ${exact[0]?.score?.toFixed(3) ?? '-'} -> ${await titleOf(exact[0]?.id_story)}`);
            console.log(`     short ${short[0]?.score?.toFixed(3) ?? '-'} -> ${await titleOf(short[0]?.id_story)}`);
        }
    }
}
process.exit(0);
