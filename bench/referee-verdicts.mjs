// The verdict of the AI on each candidate of a refereeing sentence, with the description it read, and
// the news of the week naming both the Champions League and its referees. Run inside the API container:
//   docker exec -i -w /app newsgenerator-api node --input-type=module - <userId> < this file
import {prisma} from '/app/config/db.js';
import {FeedModel} from '/app/models/feed-model.js';
import {FeedService} from '/app/services/feed-service.js';
import {embed, toSparsevec, toVector} from '/app/services/utils/embedder.js';
import {searchPrompt, sortByMeaning} from '/app/services/utils/search-ai.js';
import Links from '/app/services/utils/links.js';
import {searchesOfCategories, sentenceFeeds} from '/app/services/ingest-service.js';
import {DirectoryModel} from '/app/models/directory-model.js';

const userId = Number(process.argv[2]);
const since = new Date(Date.now() - 7 * 24 * 3600e3);
const cl = await prisma.$queryRawUnsafe(`SELECT a.title, f.url FROM articles a JOIN feeds f ON f.id = a.id_feed
    WHERE COALESCE(a.published_at, a.created_at) >= $1 AND a.title ~* '(champions league|ligue des champions|champions-league|liga de campeones|ucl)'
      AND a.title ~* '(referee|arbitr|schiedsrichter|official|VAR)'`, since);
console.log(`news of the week on the referees of the Champions League (all feeds): ${cl.length}`);
for (const n of cl.slice(0, 30)) console.log(`  ${n.title.slice(0, 110)} — ${new URL(n.url).host}`);

const SEARCHES = [
    ['en', 'referee appointments for the Champions League matches this week'],
    ['fr', "les décisions d'arbitrage et la VAR en Ligue des champions"],
];
for (const [language, sentence] of SEARCHES) {
    const category = FeedService.categories(language);
    const [own, others, searches, directory, sentences] = await Promise.all([
        FeedModel.userFeedUrls(userId, category, language), FeedModel.publicFeedUrls(category, language),
        searchesOfCategories(category, language), DirectoryModel.feedUrls(category, language), sentenceFeeds(language),
    ]);
    const urls = [...new Set([...Links.getCategoriesLinks(category, language), ...own, ...others, ...searches, ...directory, ...sentences])];
    const [vector] = await embed([sentence]);
    const candidates = await FeedModel.closestArticles({feedUrls: urls, timeframe: {start: since}, dense: toVector(vector.dense),
        sparse: toSparsevec(vector.sparse), sparseWeight: 0.5, byMeaning: 80, byWords: 30});
    const byKey = new Map();
    for (const a of candidates) {
        const key = a.id_story != null ? `s${a.id_story}` : `t${a.title}`;
        if (!byKey.has(key)) byKey.set(key, a);
    }
    const read = [...byKey.values()].map(a => ({id: String(a.id), title: a.title, description: a.description}));
    const sorted = await sortByMeaning(sentence, read);
    const of = new Map(read.map(r => [r.id, r]));
    console.log(`\n[${language}] ${sentence}: ${read.length} read`);
    for (const [kind, ids] of [['answer', sorted.answers], ['close', sorted.related]]) {
        for (const id of ids) {
            const r = of.get(id);
            console.log(`  ${kind}: ${r.title.slice(0, 100)}\n      ${(r.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)}`);
        }
    }
}
process.exit(0);
