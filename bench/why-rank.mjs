// where the news of the Google News feed of a sentence rank among all the candidates
// node --env-file=.env bench/why-rank.mjs <language> "<sentence>"
import {FeedModel} from '../models/feed-model.js';
import {embed, toVector, toSparsevec} from '../services/utils/embedder.js';
import {sentenceUrl} from '../services/utils/google-news.js';
import pg from 'pg';
const [language, sentence] = process.argv.slice(2);
const url = sentenceUrl(sentence, {days: 7, language});
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const {rows: own} = await c.query(`SELECT a.id, a.title, a.embedded_at IS NOT NULL AS embedded, a.published_at, a.created_at FROM articles a JOIN feeds f ON f.id = a.id_feed WHERE f.url = $1`, [url]);
console.log(`the feed of the sentence: ${own.length} news, embedded ${own.filter(r => r.embedded).length}`);
const {rows: pool} = await c.query(`SELECT DISTINCT f.url FROM feeds f JOIN articles a ON a.id_feed = f.id WHERE a.created_at > now() - interval '8 days'`);
const [v] = await embed([sentence]);
const rows = await FeedModel.closestArticles({feedUrls: pool.map(r => r.url), timeframe: {start: new Date(Date.now() - 7 * 864e5).toISOString()},
    dense: toVector(v.dense), sparse: toSparsevec(v.sparse), sparseWeight: 0.5, byMeaning: 2000, byWords: 0});
const rank = new Map(rows.map((r, i) => [r.id, i]));
console.log(`candidates over every feed: ${rows.length}`);
for (const r of own.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9))) {
    console.log(`${String(rank.get(r.id) ?? '-').padStart(5)} ${r.embedded ? ' ' : 'NOVEC'} ${(r.published_at ?? r.created_at).toISOString().slice(0, 10)} ${r.title.slice(0, 90)}`);
}
await c.end();
process.exit(0);
