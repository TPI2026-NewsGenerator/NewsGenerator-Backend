// The language of a feed and of a news beyond the 9 languages told by their short words: what franc
// (trigrams, 160 languages) says next to them. Feeds of a known language: the shared ones of
// db/rss-links.js and the directory (from the database), the feeds in other languages of a reader's
// list (read now, their language told by their country). Writes bench/data/languages/features.json
//   node --env-file=.env bench/language-detect.mjs
import pg from 'pg';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {francAll} from 'franc';
import {rss} from '../db/rss-links.js';
import {readFeeds} from '../services/utils/feed-finder.js';

const PER_FEED = 30;
const text = (item) => `${item.title ?? ''} ${(item.description ?? '').slice(0, 400)}`.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const known = new Map();
for (const [language, categories] of Object.entries(rss)) {
    for (const url of Object.values(categories).flat()) known.set(url, {language, from: 'shared'});
}
for (const row of (await c.query('SELECT url, language FROM directory_feeds WHERE language IS NOT NULL')).rows) {
    if (!known.has(row.url)) known.set(row.url, {language: row.language, from: 'directory'});
}
const urls = [...known.keys()].filter(url => !url.includes('youtube.com'));
const news = (await c.query(`
    SELECT f.url, a.title, a.description FROM feeds f
    JOIN LATERAL (SELECT title, description FROM articles WHERE id_feed = f.id ORDER BY created_at DESC LIMIT ${PER_FEED}) a ON true
    WHERE f.url = ANY($1)`, [urls])).rows;
await c.end();

const feeds = new Map();
for (const row of news) {
    const feed = feeds.get(row.url) ?? {url: row.url, ...known.get(row.url), texts: []};
    feed.texts.push(text(row));
    feeds.set(row.url, feed);
}

// the feeds of the list in other languages, their language told by the country of their site
const COUNTRY = {hu: 'hu', gr: 'el', hr: 'hr', se: 'sv', dk: 'da', no: 'no', fi: 'fi', ro: 'ro', bg: 'bg', ru: 'ru', ua: 'uk',
    tr: 'tr', cz: 'cs', sk: 'sk', si: 'sl', ee: 'et', lv: 'lv', lt: 'lt', is: 'is', ge: 'ka', am: 'hy', az: 'az', rs: 'sr',
    ba: 'bs', mk: 'mk', al: 'sq', il: 'he', by: 'ru', md: 'ro', pt: 'pt', ad: 'ca', me: 'sr', kz: 'ru', fo: 'fo', pl: 'pl'};
const check = JSON.parse(readFileSync('bench/data/uefa/check.json', 'utf8')).results
    .filter(result => result.verdict === 'feed-other-language' && result.best);
const read = await readFeeds([...new Set(check.map(result => result.best.url))]);
for (const {url, items} of read) {
    const tld = new URL(url).host.split('.').pop();
    if (!COUNTRY[tld] || feeds.has(url)) continue;
    feeds.set(url, {url, language: COUNTRY[tld], from: 'list', texts: items.slice(0, PER_FEED).map(text)});
}

const top = (value, n) => francAll(value, {minLength: 10}).slice(0, n);
const results = [...feeds.values()].filter(feed => feed.texts.length >= 5).map(feed => ({
    url: feed.url, language: feed.language, from: feed.from,
    feedTop: top(feed.texts.join(' '), 5),
    news: feed.texts.map(value => ({text: value, top: top(value, 5)})),
}));
mkdirSync('bench/data/languages', {recursive: true});
writeFileSync('bench/data/languages/features.json', JSON.stringify(results));
const count = (from) => results.filter(result => result.from === from).length;
console.log(`${results.length} feeds: ${count('shared')} shared, ${count('directory')} directory, ${count('list')} of the list; ${results.reduce((n, r) => n + r.news.length, 0)} news`);
