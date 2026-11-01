// What the search of words in the texts of the news costs by how often the tagger met them (env PROFILE_ID):
// 25 names of each class (met 1-2 times, 3-19, 20-300 times, never linked to Wikidata), searched in the texts
// (ILIKE, answered by the trigram index) over 1 and 30 days, in one lot. Read only
import {prisma} from '../config/db.js';
import {FeedModel} from '../models/feed-model.js';
import {feedsOf} from '../services/briefing-service.js';
import {Filter} from '../services/utils/filter.js';

const feedUrls = await feedsOf(Number(process.env.PROFILE_ID ?? 7));
const classes = [['met 1-2 times', 1, 2], ['met 3-19 times', 3, 19], ['met 20-300 times', 20, 300]];
for (const [label, least, most] of classes) {
    const names = (await prisma.$queryRawUnsafe(`
        SELECT name FROM mentions WHERE qid IS NULL AND kind = 'person' AND seen BETWEEN $1 AND $2 AND length(name) BETWEEN 6 AND 30 AND name ~ ' '
        ORDER BY md5(key) LIMIT 25`, least, most)).map(row => row.name);
    const texts = [...new Set(names.flatMap(name => [name, Filter.withoutAccents(name)]))];
    for (const days of [1, 30]) {
        const started = Date.now();
        const articles = await FeedModel.articlesHolding({feedUrls, texts, since: new Date(Date.now() - days * 24 * 3600e3)});
        console.log(`${label}, ${days} days: ${articles.length} articles in ${Date.now() - started} ms`);
    }
}
process.exit(0);
