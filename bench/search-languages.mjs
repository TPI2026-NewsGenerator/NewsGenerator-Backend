// A sentence searched in the feeds of its language only (as getNews does) and in the feeds of every
// language of the reader's profile: the answers and close news of the AI for each.
//   node --env-file=.env bench/search-languages.mjs <userId>
import process from 'node:process';
import {prisma} from '../config/db.js';
import {FeedModel} from '../models/feed-model.js';
import {FeedService} from '../services/feed-service.js';
import {embed, toSparsevec, toVector} from '../services/utils/embedder.js';
import {sortByMeaning} from '../services/utils/search-ai.js';
import {sourceOf} from '../services/utils/reading-order.js';
import Links from '../services/utils/links.js';
import {searchesOfCategories, sentenceFeeds} from '../services/ingest-service.js';
import {DirectoryModel} from '../models/directory-model.js';

const userId = Number(process.argv[2]);
const since = new Date(Date.now() - 7 * 864e5);
const feedsOf = async (language) => {
    const known = FeedService.categories(language).length > 0;
    const category = FeedService.categories(known ? language : 'en');
    const lists = await Promise.all([
        FeedModel.userFeedUrls(userId, category, language), FeedModel.publicFeedUrls(category, language),
        searchesOfCategories(category, language), DirectoryModel.feedUrls(category, language), sentenceFeeds(language),
    ]);
    return [...new Set([...(known ? Links.getCategoriesLinks(category, language) : []), ...lists.flat()])];
};
const profile = await prisma.user_profiles.findUnique({where: {id_user: userId}});
const every = [...new Set((await Promise.all(profile.languages.map(feedsOf))).flat())];
const SEARCHES = [
    ['fr', "les décisions d'arbitrage et la VAR en Ligue des champions"],
    ['fr', "les désignations d'arbitres"],
    ['de', 'Schiedsrichter im Fußball'],
];
for (const [language, sentence] of SEARCHES) {
    const [vector] = await embed([sentence]);
    for (const [name, urls] of [['its language', await feedsOf(language)], ['every language', every]]) {
        const candidates = await FeedModel.closestArticles({feedUrls: urls, timeframe: {start: since}, dense: toVector(vector.dense),
            sparse: toSparsevec(vector.sparse), sparseWeight: 0.5, byMeaning: 80, byWords: 30});
        const byKey = new Map();
        for (const a of candidates) {
            const key = a.id_story != null ? `s${a.id_story}` : `t${a.title}`;
            if (!byKey.has(key)) byKey.set(key, a);
        }
        const read = [...byKey.values()];
        const sorted = await sortByMeaning(sentence, read.map(a => ({id: String(a.id), title: a.title, description: a.description})));
        const of = new Map(read.map(a => [String(a.id), a]));
        console.log(`\n[${language}] ${sentence} — ${name}: ${urls.length} feeds, ${read.length} read, ${sorted.answers.length} answers, ${sorted.related.length} close`);
        for (const [kind, ids] of [['+', sorted.answers], ['~', sorted.related]]) {
            for (const id of ids.slice(0, 15)) console.log(`  ${kind} [${of.get(id).lang ?? '?'}] ${of.get(id).title.slice(0, 95)} (${sourceOf(of.get(id).source_url ?? of.get(id).link)})`);
        }
    }
}
process.exit(0);
