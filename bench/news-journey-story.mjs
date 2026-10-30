// One story of bench/news-journey.mjs looked at closely, for docs/Parcours d'une nouvelle: its news
// (medium, language, when read and embedded), the vectors of its best news (the first numbers of the
// dense ones, the words of the sparse ones), how close its news are to it, to the interests of the
// reader and to the stories it did not join, and its thread. Read only.
//   node --env-file=.env bench/news-journey-story.mjs <out.json> <profileId> <storyId> <bestArticleId> [mergedStoryId...]
import {writeFileSync} from 'node:fs';
import pg from 'pg';
import {richText} from '../services/ingest-service.js';

const [out, profileArg, storyArg, bestArg, ...mergedArgs] = process.argv.slice(2);
const [profileId, storyId, bestId] = [profileArg, storyArg, bestArg].map(Number);
const merged = mergedArgs.map(Number);
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const q = async (sql, params) => (await db.query(sql, params)).rows;

const [best] = await q(`SELECT id, id_story, lang, medium, title, description, link, published_at, created_at, embedded_at,
        title_sparse::text AS title_sparse, text_sparse::text AS text_sparse,
        (title_dense::text) AS title_dense, (text_dense::text) AS text_dense
    FROM articles WHERE id = $1`, [bestId]);
const firstOf = (text) => JSON.parse(text).slice(0, 8);
const sparseOf = (text) => text.replace(/^\{|\}\/\d+$/g, '').split(',').filter(Boolean)
    .map(entry => entry.split(':')).map(([index, weight]) => ({token: Number(index) - 1, weight: Number(weight)}))
    .sort((a, b) => b.weight - a.weight);

// the news of the story and of the ones merged into its card, each against the best news
const members = await q(`
    SELECT a.id, a.id_story, a.lang, a.medium, a.title, left(a.description, 160) AS description, a.published_at, a.created_at, a.embedded_at,
           -(a.title_dense <#> b.title_dense) AS title_dense,
           -(a.title_sparse <#> b.title_sparse) AS title_sparse,
           -(a.text_dense <#> b.text_dense) AS text_dense,
           a.medium IS NOT DISTINCT FROM b.medium AS same_medium
    FROM articles a, articles b
    WHERE b.id = $1 AND a.id_story = ANY($2::int[])
    ORDER BY a.id_story, COALESCE(a.published_at, a.created_at)`, [bestId, [storyId, ...merged]]);

// the best news against each interest of the profile, as rank_profile_stories scores it (sparse weight 0.5)
const interests = await q(`
    SELECT i.id, i.text, i.weight,
           -(b.text_dense <#> i.dense) AS dense,
           -(b.text_sparse <#> i.sparse) AS sparse,
           i.weight * (-(b.text_dense <#> i.dense) - 0.5 * (b.text_sparse <#> i.sparse)) AS score,
           i.sparse::text AS interest_sparse
    FROM profile_interests i, articles b WHERE b.id = $1 AND i.id_profile = $2 AND i.dense IS NOT NULL ORDER BY i.position`, [bestId, profileId]);

// the closest other stories of its language when it was grouped: why it did not join them
const others = await q(`
    WITH near AS (
        SELECT s.id FROM stories s, articles b
        WHERE b.id = $1 AND s.lang = b.lang AND s.id <> b.id_story AND s.centroid IS NOT NULL
          AND s.updated_at >= COALESCE(b.published_at, b.created_at) - interval '48 hours'
        ORDER BY s.centroid <#> b.text_dense LIMIT 6
    )
    SELECT m.id_story, count(*) AS news, min(m.title) AS a_title,
           avg(-(m.title_dense <#> b.title_dense) - (m.title_sparse <#> b.title_sparse)) FILTER (WHERE m.medium IS DISTINCT FROM b.medium) AS title_score,
           avg(-(m.text_dense <#> b.text_dense)) FILTER (WHERE m.medium IS DISTINCT FROM b.medium) AS text_score
    FROM articles m, articles b
    WHERE b.id = $1 AND m.id_story IN (SELECT id FROM near)
    GROUP BY m.id_story ORDER BY title_score DESC NULLS LAST`, [bestId]);

// its thread: the other facts of the affair
const [story] = await q(`SELECT id, lang, id_thread, media, created_at, updated_at FROM stories WHERE id = $1`, [storyId]);
const thread = story?.id_thread ? await q(`
    SELECT s.id, s.created_at, s.updated_at, cardinality(s.media) AS media,
           (SELECT title FROM articles a WHERE a.id_story = s.id ORDER BY COALESCE(a.published_at, a.created_at) LIMIT 1) AS title,
           -(s.centroid <#> (SELECT centroid FROM stories WHERE id = $2)) AS likeness
    FROM stories s WHERE s.id_thread = $1 ORDER BY s.created_at`, [story.id_thread, storyId]) : [];
const [threadRow] = story?.id_thread ? await q(`SELECT id, n_stories, cardinality(media) AS media, created_at, updated_at FROM threads WHERE id = $1`, [story.id_thread]) : [];

await db.end();
writeFileSync(out, JSON.stringify({
    best: {...best, richText: richText(best.title, best.description), title_dense: firstOf(best.title_dense), text_dense: firstOf(best.text_dense),
        text_dense_all: JSON.parse(best.text_dense),
        title_sparse: sparseOf(best.title_sparse), text_sparse: sparseOf(best.text_sparse)},
    members, interests: interests.map(i => ({...i, interest_sparse: sparseOf(i.interest_sparse).slice(0, 15)})), others, story, threadRow, thread,
}, null, 1));
console.log(`${members.length} news, ${others.length} other stories, thread of ${thread.length}`);
process.exit(0);
