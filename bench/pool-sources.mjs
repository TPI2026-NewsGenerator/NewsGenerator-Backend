// what a search of one reader finds with the sources of the other readers too
// node --env-file=.env bench/pool-sources.mjs <userId> <language> "<query>" [...]
import pg from 'pg';
import {NewsService} from '../services/news-service.js';
import Links from '../services/utils/links.js';
import {FeedModel} from '../models/feed-model.js';
import {ProfileModel} from '../models/profile-model.js';
import {interestSearchUrls} from '../services/utils/google-news.js';

const [userId, language, ...queries] = process.argv.slice(2);
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const cats = ['world', 'press', 'sport', 'politics', 'economy', 'technology', 'science'];
const own = await FeedModel.userFeedUrls(Number(userId), cats, language);
const others = (await c.query(`SELECT DISTINCT url, origin, shared FROM user_feeds WHERE id_user <> $1 AND (language = $2 OR language IS NULL)`, [userId, language])).rows;
const publicOthers = others.filter(f => f.origin === 'profile' || f.shared).map(f => f.url);
const allOthers = others.map(f => f.url);
const searches = [...new Set((await ProfileModel.searchesOf()).flatMap(({searches, languages}) => interestSearchUrls(searches, languages)))]
    .filter(url => url.includes(`hl=${language}`));
const mine = new Set((await ProfileModel.searchesOf(Number(userId))).flatMap(({searches, languages}) => interestSearchUrls(searches, languages)));
const otherSearches = searches.filter(url => !mine.has(url));
const base = [...new Set([...Links.getCategoriesLinks(cats, language), ...own])];
const pools = {
    'today': base,
    '+ others found for profiles/shared': [...new Set([...base, ...publicOthers])],
    '+ all others feeds': [...new Set([...base, ...allOthers])],
    '+ all others feeds + their Google searches': [...new Set([...base, ...allOthers, ...otherSearches])],
};
console.log(`feeds: base ${base.length}, others public ${publicOthers.length}, others all ${allOthers.length}, others' searches ${otherSearches.length}`);
for (const query of queries) {
    console.log(`\n=== ${query}`);
    for (const [name, feedUrls] of Object.entries(pools)) {
        const r = await NewsService.searchByMeaning({query, feedUrls, timeframe: {start: new Date(Date.now() - 30 * 864e5).toISOString()}});
        const answers = r.news.filter(n => n.match === 'answer');
        console.log(`  ${name}: ${answers.length} answers, ${r.news.length - answers.length} related`);
        for (const n of (answers.length ? answers : r.news).slice(0, 12)) console.log(`     ${n.match} ${n.source ?? ""} | ${n.title?.slice(0, 95)}`);
    }
}
await c.end();
process.exit(0);
