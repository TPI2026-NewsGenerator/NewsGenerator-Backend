// Removes the trading sources of the account fab (4) added on 2026-10-04, as the delete button of the
// sources page does (FeedModel.deleteUserFeed). Their articles already read stay until they are 30 days old.
//   node --env-file=.env bench/remove-trading-feeds.mjs
import {prisma} from '../config/db.js';
import {FeedModel} from '../models/feed-model.js';

const urls = [
    'https://www.tradingview.com/feed/', 'http://www.tradingeconomics.com/rss/news.aspx', 'https://fxstreet.com/rss',
    'https://fr.tradingview.com/feed', 'http://www.tradingsat.com/rssfeed.php', 'https://tradingqna.com/latest.rss',
    'http://www.tradingpub.com/feed/', 'http://www.optimusfutures.com/tradeblog/feed/', 'http://www.tradingheroes.com/feed/',
    'http://ibankcoin.com/flyblog/feed/', 'http://www.tradingwithrayner.com/feed/', 'https://www.tradingforaliving.pl/feed/',
    'http://www.trading-attitude.com/feed',
];
const feeds = await prisma.user_feeds.findMany({where: {id_user: 4, url: {in: urls}}, select: {id: true, site: true}});
let removed = 0;
for (const feed of feeds) removed += await FeedModel.deleteUserFeed(4, feed.id);
console.log(`found ${feeds.length}, removed ${removed}: ${feeds.map(feed => feed.site).join(', ')}`);
process.exit(0);
