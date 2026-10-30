// The grouping of one news as it was when it got its vectors, for docs/a-to-z/parcours-d-une-nouvelle:
// for the story it joined and the closest others, the members of other media embedded before it, and
// the scores assign_stories reads (the titles dense + sparse, the texts dense), with how long each story
// had been quiet. Also the tokens its sparse vectors share with each interest of the profile. Read only.
//   node --env-file=.env bench/news-journey-grouping.mjs <out.json> <profileId> <articleId> <storyId...>
import {writeFileSync} from 'node:fs';
import pg from 'pg';

const [out, profileArg, articleArg, ...storyArgs] = process.argv.slice(2);
const [profileId, articleId] = [profileArg, articleArg].map(Number);
const stories = storyArgs.map(Number);
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
await db.query('SET default_transaction_read_only = on');
const q = async (sql, params) => (await db.query(sql, params)).rows;

const [news] = await q(`SELECT id, medium, embedded_at, COALESCE(published_at, created_at) AS at FROM articles WHERE id = $1`, [articleId]);

// each story with its members of other media embedded before the news, as assign_stories scored them
const scored = await q(`
    SELECT m.id_story,
           count(*)::int AS members,
           count(DISTINCT m.medium)::int AS media,
           min(m.title) FILTER (WHERE m.medium IS DISTINCT FROM b.medium) AS a_title,
           avg(-(m.title_dense <#> b.title_dense)) FILTER (WHERE m.medium IS DISTINCT FROM b.medium) AS title_dense,
           avg(-(m.title_sparse <#> b.title_sparse)) FILTER (WHERE m.medium IS DISTINCT FROM b.medium) AS title_sparse,
           avg(-(m.text_dense <#> b.text_dense)) FILTER (WHERE m.medium IS DISTINCT FROM b.medium) AS text_dense,
           max(COALESCE(m.published_at, m.created_at)) AS last_news
    FROM articles m, articles b
    WHERE b.id = $1 AND m.id_story = ANY($2::int[]) AND m.id <> b.id AND m.embedded_at < b.embedded_at
    GROUP BY m.id_story`, [articleId, stories]);

// the members of the joined story, of other media, against the news, closest first
const titles = await q(`
    SELECT m.medium, m.lang, m.title, -(m.title_dense <#> b.title_dense) AS dense, -(m.title_sparse <#> b.title_sparse) AS sparse,
           m.embedded_at < b.embedded_at AS before
    FROM articles m, articles b
    WHERE b.id = $1 AND m.id_story = $2 AND m.medium IS DISTINCT FROM b.medium
    ORDER BY dense DESC`, [articleId, stories[0]]);

// the tokens the text of the news shares with each interest of the profile: weight x weight
const parse = (text) => new Map(text.replace(/^\{|\}\/\d+$/g, '').split(',').filter(Boolean)
    .map(entry => entry.split(':')).map(([index, weight]) => [Number(index) - 1, Number(weight)]));
const [vectors] = await q(`SELECT text_sparse::text AS sparse FROM articles WHERE id = $1`, [articleId]);
const newsTokens = parse(vectors.sparse);
const interests = (await q(`SELECT id, text, sparse::text AS sparse FROM profile_interests WHERE id_profile = $1 AND sparse IS NOT NULL ORDER BY position`, [profileId]))
    .map(interest => {
        const tokens = parse(interest.sparse);
        const shared = [...newsTokens].filter(([token]) => tokens.has(token))
            .map(([token, weight]) => ({token, news: weight, interest: tokens.get(token), product: weight * tokens.get(token)}))
            .sort((a, b) => b.product - a.product);
        return {id: interest.id, text: interest.text, shared, total: shared.reduce((n, s) => n + s.product, 0)};
    });

await db.end();
writeFileSync(out, JSON.stringify({news, scored: scored.map(row => ({...row,
    quietHours: (new Date(news.embedded_at) - new Date(row.last_news)) / 3600e3})), titles, interests}, null, 1));
console.log(`${scored.length} stories scored, ${titles.length} titles, ${interests.length} interests`);
process.exit(0);
