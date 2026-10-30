// The news of the 48 h of a reader's feeds outside their languages: which languages, which feeds.
//   node --env-file=.env bench/funnel-languages.mjs <userId>
import process from 'node:process';
import {prisma} from '../config/db.js';
import {rss} from '../db/rss-links.js';
import {ProfileModel} from '../models/profile-model.js';
import {FeedModel} from '../models/feed-model.js';
import {searchesOfUser} from '../services/ingest-service.js';

const userId = Number(process.argv[2]);
const profile = await ProfileModel.get(userId);
console.log('profile languages:', profile.languages.join(','));
const own = new Set(await FeedModel.userFeedUrls(userId));
const feedUrls = [...new Set([...profile.languages.flatMap(l => Object.values(rss[l] ?? {}).flat()), ...own, ...await searchesOfUser(userId)])];
const rows = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(a.lang, '(none)') AS lang, count(DISTINCT a.link)::int AS news, count(DISTINCT f.url)::int AS feeds,
           count(DISTINCT a.link) FILTER (WHERE f.url = ANY($4))::int AS from_own
    FROM articles a JOIN feeds f ON f.id = a.id_feed
    WHERE f.url = ANY($1) AND COALESCE(a.published_at, a.created_at) >= $2 AND (a.lang IS NULL OR NOT a.lang = ANY($3))
    GROUP BY 1 ORDER BY 2 DESC`, feedUrls, new Date(Date.now() - 48 * 3600e3), profile.languages, [...own]);
console.log(rows.map(r => `${r.lang} ${r.news} (${r.feeds} feeds, ${r.from_own} from own)`).join('\n'));
const uf = await prisma.$queryRawUnsafe(`SELECT COALESCE(language,'(none)') AS l, count(*)::int AS n FROM user_feeds WHERE id_user = $1 GROUP BY 1 ORDER BY 2 DESC`, userId);
console.log('own feeds by declared language:', uf.map(r => `${r.l} ${r.n}`).join(', '));
const none = await prisma.$queryRawUnsafe(`
    SELECT f.url, count(*)::int AS n FROM articles a JOIN feeds f ON f.id = a.id_feed
    WHERE f.url = ANY($1) AND a.lang IS NULL AND COALESCE(a.published_at, a.created_at) >= $2 GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
    feedUrls, new Date(Date.now() - 48 * 3600e3));
console.log('feeds of news without language:', none.map(r => `${r.n} ${r.url.slice(0, 80)}`).join('\n  '));
process.exit(0);
