// Why the searches on refereeing find little: the news about referees of the last 7 days in the feeds a
// search reads (the language of the search only, as getNews does) and in every language of the reader,
// and how many of them reach the candidates the AI reads. Run inside the API container:
//   docker exec -i -w /app newsgenerator-api node --input-type=module - <userId> < this file
import {prisma} from '/app/config/db.js';
import {FeedModel} from '/app/models/feed-model.js';
import {FeedService} from '/app/services/feed-service.js';
import {embed, toSparsevec, toVector} from '/app/services/utils/embedder.js';
import Links from '/app/services/utils/links.js';
import {searchesOfCategories, sentenceFeeds} from '/app/services/ingest-service.js';
import {DirectoryModel} from '/app/models/directory-model.js';

const userId = Number(process.argv[2]);
const REFEREE = String.raw`(arbitr|referee|schiedsrichter|árbitr|scheidsrechter|\mVAR\M|videobeweis|IFAB|PGMOL|\mVAR-|referee)`;
const since = new Date(Date.now() - 7 * 24 * 3600e3);
const feedsOf = async (language) => {
    const known = FeedService.categories(language).length > 0;
    const category = known ? FeedService.categories(language) : FeedService.categories('en');
    const [own, others, searches, directory, sentences] = await Promise.all([
        FeedModel.userFeedUrls(userId, category, language), FeedModel.publicFeedUrls(category, language),
        searchesOfCategories(category, language), DirectoryModel.feedUrls(category, language), sentenceFeeds(language),
    ]);
    return [...new Set([...(known ? Links.getCategoriesLinks(category, language) : []), ...own, ...others, ...searches, ...directory, ...sentences])];
};
const refereeNews = async (urls) => prisma.$queryRawUnsafe(`
    SELECT a.id, a.title, a.lang, f.url, (a.embedded_at IS NOT NULL) AS embedded FROM articles a JOIN feeds f ON f.id = a.id_feed
    WHERE f.url = ANY($1::text[]) AND COALESCE(a.published_at, a.created_at) >= $2 AND a.title ~* $3`, urls, since, REFEREE);

const profile = await prisma.user_profiles.findUnique({where: {id_user: userId}});
console.log('profile languages:', profile.languages.join(','));
const ownAll = await prisma.user_feeds.findMany({where: {id_user: userId}, select: {url: true, language: true, category: true}});
const byLang = {};
for (const f of ownAll) byLang[f.language ?? 'null'] = (byLang[f.language ?? 'null'] ?? 0) + 1;
console.log('own feeds per language:', JSON.stringify(byLang));
const byCat = {};
for (const f of ownAll) byCat[f.category ?? 'null'] = (byCat[f.category ?? 'null'] ?? 0) + 1;
console.log('own feeds per category:', JSON.stringify(byCat));

const SEARCHES = [
    ['fr', "les décisions d'arbitrage et la VAR en Ligue des champions"],
    ['en', 'referee appointments for the Champions League matches this week'],
    ['de', 'Schiedsrichter Fehlentscheidung Videobeweis Bundesliga'],
];
const all = [...new Set((await Promise.all(profile.languages.map(feedsOf))).flat())];
const allReferee = await refereeNews(all);
console.log(`\nevery language of the profile: ${all.length} feeds, ${allReferee.length} news on referees (${allReferee.filter(n => n.embedded).length} embedded)`);
const perLang = {};
for (const n of allReferee) perLang[n.lang] = (perLang[n.lang] ?? 0) + 1;
console.log('  per language:', JSON.stringify(perLang));
for (const [language, sentence] of SEARCHES) {
    const urls = await feedsOf(language);
    const referee = await refereeNews(urls);
    const [vector] = await embed([sentence]);
    const args = {timeframe: {start: since}, dense: toVector(vector.dense), sparse: toSparsevec(vector.sparse), sparseWeight: 0.5, byMeaning: 80, byWords: 30};
    const candidates = await FeedModel.closestArticles({feedUrls: urls, ...args});
    const ids = new Set(referee.map(n => n.id));
    const candidatesAll = await FeedModel.closestArticles({feedUrls: all, ...args});
    const idsAll = new Set(allReferee.map(n => n.id));
    console.log(`\n[${language}] ${sentence}\n  its language: ${urls.length} feeds, ${referee.length} news on referees, ${candidates.filter(c => ids.has(c.id)).length} of ${candidates.length} candidates`);
    console.log(`  every language: ${candidatesAll.filter(c => idsAll.has(c.id)).length} of ${candidatesAll.length} candidates on referees`);
    for (const c of candidatesAll.slice(0, 25)) console.log(`    ${idsAll.has(c.id) ? 'R' : ' '} ${Number(c.score).toFixed(3)} [${c.lang ?? '?'}] ${c.title.slice(0, 100)}`);
}
console.log('\nsample of referee news in every language:');
for (const n of allReferee.slice(0, 40)) console.log(`  [${n.lang}] ${n.title.slice(0, 110)}`);
process.exit(0);
