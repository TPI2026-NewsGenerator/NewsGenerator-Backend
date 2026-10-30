// the vectors of every news still without them, the oldest first, without grouping them: the search
// needs only the vectors; the next run of the ingestion groups the news of the window
// node --env-file=.env bench/embed-now.mjs
import process from 'node:process';
import {prisma} from '../config/db.js';
import {StoryModel} from '../models/story-model.js';
import {embed, toSparsevec, toVector} from '../services/utils/embedder.js';
import {richText} from '../services/ingest-service.js';
import {languageOf} from '../services/utils/language.js';

const BATCH = 300;
let total = 0;
const started = Date.now();
for (;;) {
    const pending = await prisma.$queryRawUnsafe(`
        SELECT a.id, a.title, a.description,
               COALESCE((SELECT uf.language FROM user_feeds uf WHERE uf.url = f.url AND uf.language IS NOT NULL LIMIT 1),
                        (SELECT d.language FROM directory_feeds d WHERE d.url = f.url)) AS feed_language
        FROM articles a JOIN feeds f ON f.id = a.id_feed
        WHERE a.embedded_at IS NULL
        ORDER BY COALESCE(a.published_at, a.created_at) ASC
        LIMIT ${BATCH}`);
    if (pending.length === 0) break;
    const texts = [...new Set(pending.flatMap(a => [a.title, richText(a.title, a.description)]))];
    const vectors = new Map((await embed(texts)).map((vector, i) => [texts[i], vector]));
    await StoryModel.saveVectors(pending.map(a => {
        const title = vectors.get(a.title);
        const text = vectors.get(richText(a.title, a.description));
        return {id: a.id, lang: languageOf(`${a.title} ${a.description ?? ''}`, a.feed_language) ?? 'en',
            titleDense: toVector(title.dense), titleSparse: toSparsevec(title.sparse),
            textDense: toVector(text.dense), textSparse: toSparsevec(text.sparse)};
    }));
    total += pending.length;
    console.log(`${total} embedded, ${Math.round((Date.now() - started) / 1000)} s`);
    if (pending.length < BATCH) break;
}
process.exit(0);
