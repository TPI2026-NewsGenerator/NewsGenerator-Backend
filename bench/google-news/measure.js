//
//  Author: Fabian Rostello
//  Date: 26.09.2026
//  File: measure.js
//  Description: What Google News would bring to a reader, measured before building anything on it:
//               the news on their interests our feeds miss, the sites read through the RSS-Bridge a
//               "site:" search would cover, and whether its links can be decoded to be read
//
//  node --env-file=.env bench/google-news/measure.js [--user 4] [--parts coverage,sites,decode]
//                                                     [--decode 20] [--interval 1500]
//
//  coverage  needs the embedder (the titles of Google News are compared with the interests)
//  sites     the feeds of the reader read through the bridge, against "site:" searches
//  decode    the real address of Google News links, the way google-news-url-decoder does it
//
// Nothing is written in the database. Google is asked slowly (--interval between two requests) and
// the measure stops at the first sign of a block (429, a consent or captcha page): the discovery of
// the sources asks Google News too, a blocked address would stop it for every reader.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {parseArgs} from 'node:util';
import {rss} from '../../db/rss-links.js';
import {prisma} from '../../config/db.js';
import {ProfileModel} from '../../models/profile-model.js';
import {FeedModel} from '../../models/feed-model.js';
import {knownMedia} from '../../services/source-service.js';
import {siteOf} from '../../services/feedback-service.js';
import {JUDGE_THRESHOLD} from '../../services/discovery-service.js';
import {search} from '../../services/utils/google-news.js';
import {parseSearch} from '../../services/utils/profile-ai.js';
import {denseSimilarity, embed, parseVector, toVector} from '../../services/utils/embedder.js';
import {isBridgeUrl, nameOf} from '../../services/utils/public-url.js';

const {values: options} = parseArgs({options: {
    user: {type: 'string', default: '4'},
    parts: {type: 'string', default: 'coverage,sites,decode'},
    decode: {type: 'string', default: '20'},
    interval: {type: 'string', default: '1500'},
}});
const userId = Number(options.user);
const parts = new Set(options.parts.split(','));
const INTERVAL_MS = Number(options.interval);
const WINDOW_HOURS = 48;
// the dense cosine of two titles telling the same news: the stories group at 0.70 with dense and
// sparse together (see assign_stories), the dense alone needs a bit more
const SAME_STORY = 0.75;
const SAME_ARTICLE = 0.85;          // and from the same medium: the article we already read
const TITLES_MATCH = 0.6;           // words shared by two titles of one site, for the "site:" part
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';
const OUT = path.join(import.meta.dirname, '../data/google-news');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const since = new Date(Date.now() - WINDOW_HOURS * 3600e3);
const results = {user: userId, at: new Date().toISOString(), requests: 0};

class Blocked extends Error {}

// one request to Google, never two too close, stopped at the first sign of a block
let last = 0;
const polite = async (task) => {
    const wait = last + INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    results.requests++;
    try {
        return await task();
    } catch (err) {
        if (/429|captcha|consent|unusual traffic/i.test(err.message)) throw new Blocked(err.message);
        throw err;
    }
};

const googleSearch = (keywords, language) => polite(() => search(keywords, {days: WINDOW_HOURS / 24, language}));

// ---- coverage ---------------------------------------------------------------------------------

// the news of the searches of every interest, once each, of the window
const googleNews = async (interests, languages) => {
    const news = new Map();
    for (const interest of interests) {
        for (const {lang, q} of interest.searches.map(parseSearch).filter(Boolean)) {
            if (!languages.includes(lang)) continue;
            const found = await googleSearch([q], lang);
            console.log(`  "${q}" (${lang}): ${found.news.length} news`);
            for (const item of found.news) {
                if (item.publishedAt && new Date(item.publishedAt) < since) continue;
                if (!news.has(item.url)) news.set(item.url, {...item, lang, search: q});
            }
        }
    }
    return [...news.values()];
};

// the closest article of the feeds of the reader in the window, by the dense vector of its title
const closest = async (dense, feedUrls) => (await prisma.$queryRawUnsafe(`
    SELECT a.title, a.medium, a.id_story, -(a.title_dense <#> $1::vector) AS similarity
    FROM articles a
    JOIN feeds f ON f.id = a.id_feed
    WHERE f.url = ANY($2::text[]) AND a.embedded_at IS NOT NULL
      AND COALESCE(a.published_at, a.created_at) >= $3::timestamptz
    ORDER BY a.title_dense <#> $1::vector
    LIMIT 1`, toVector(dense), feedUrls, since))[0] ?? null;

// the stories of the window our feeds already have on the interests, for comparison
const ourRelevantStories = async (feedUrls) => (await prisma.$queryRawUnsafe(`
    SELECT count(DISTINCT a.id_story)::int AS stories, count(DISTINCT a.medium)::int AS media
    FROM articles a
    JOIN feeds f ON f.id = a.id_feed
    WHERE f.url = ANY($1::text[]) AND a.embedded_at IS NOT NULL AND a.id_story IS NOT NULL
      AND COALESCE(a.published_at, a.created_at) >= $2::timestamptz
      AND EXISTS (SELECT 1 FROM profile_interests i WHERE i.id_user = $3::int AND i.dense IS NOT NULL
                  AND -(a.title_dense <#> i.dense) >= $4::real)`,
    feedUrls, since, userId, JUDGE_THRESHOLD))[0];

// the new stories told by several Google News items: grouped when their titles are one news
const groupNew = (items) => {
    const groups = [];
    for (const item of items.sort((a, b) => b.score - a.score)) {
        const group = groups.find(other => denseSimilarity(other[0].dense, item.dense) >= SAME_STORY);
        if (group) group.push(item);
        else groups.push([item]);
    }
    return groups;
};

const coverage = async (profile, feedUrls) => {
    console.log('\n== Coverage: the searches of the interests on Google News ==');
    await embed(['check']);         // the embedder first: no request to Google for nothing
    const interests = await ProfileModel.interestsForDiscovery(userId);
    const denses = interests.map(interest => parseVector(interest.dense));
    const known = await knownMedia(userId);

    const news = await googleNews(interests, profile.languages);
    const vectors = await embed(news.map(item => item.title));
    for (const [i, item] of news.entries()) {
        item.dense = vectors[i].dense;
        item.score = Math.max(...denses.map(dense => denseSimilarity(item.dense, dense)));
    }
    const relevant = news.filter(item => item.score >= JUDGE_THRESHOLD);

    const kinds = {read: [], corroboration: [], missedKnownMedium: [], missedNewMedium: []};
    for (const item of relevant) {
        const found = await closest(item.dense, feedUrls);
        const sameMedium = found && nameOf(found.medium ?? '') === nameOf(item.site);
        if (found && found.similarity >= SAME_ARTICLE && sameMedium) kinds.read.push(item);
        else if (found && found.similarity >= SAME_STORY) kinds.corroboration.push({...item, story: found.id_story});
        else if (known.has(nameOf(item.site))) kinds.missedKnownMedium.push(item);
        else kinds.missedNewMedium.push(item);
    }

    const missed = groupNew([...kinds.missedKnownMedium, ...kinds.missedNewMedium]);
    const ours = await ourRelevantStories(feedUrls);
    const summary = {
        googleNews: news.length,
        onInterests: relevant.length,
        alreadyRead: kinds.read.length,
        // media telling a story we have, that we don't read: they would count in its corroboration
        moreMediaOnOurStories: kinds.corroboration.length,
        storiesGainingMedia: new Set(kinds.corroboration.map(item => item.story)).size,
        // stories we don't have at all
        missedStories: missed.length,
        missedFromMediaWeRead: kinds.missedKnownMedium.length,
        missedFromOtherMedia: kinds.missedNewMedium.length,
        ourStoriesOnInterests: ours.stories,
        ourMediaOnInterests: ours.media,
    };
    console.table(summary);
    console.log('\nStories our feeds miss, the closest to the interests first:');
    for (const group of missed.slice(0, 25)) {
        console.log(`  ${group[0].score.toFixed(3)}  ${group[0].title}  [${[...new Set(group.map(item => item.site))].join(', ')}]`);
    }

    results.coverage = {
        summary,
        missed: missed.map(group => ({score: group[0].score, title: group[0].title, sites: group.map(item => item.site), search: group[0].search})),
        corroboration: kinds.corroboration.map(({title, site, score, story}) => ({title, site, score, story})),
    };
    return news;
};

// ---- sites ------------------------------------------------------------------------------------

const words = (title) => new Set(title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(word => word.length > 2));
const jaccard = (a, b) => {
    const shared = [...a].filter(word => b.has(word)).length;
    return shared / (a.size + b.size - shared || 1);
};
const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};

const ourArticles = (feedUrl) => prisma.$queryRawUnsafe(`
    SELECT a.title, a.created_at, a.published_at
    FROM articles a JOIN feeds f ON f.id = a.id_feed
    WHERE f.url = $1 AND COALESCE(a.published_at, a.created_at) >= $2::timestamptz`, feedUrl, since);

const sites = async (profile) => {
    console.log('\n== Sites read through the RSS-Bridge, against a "site:" search ==');
    const feeds = (await FeedModel.listUserFeeds(userId)).filter(feed => isBridgeUrl(feed.url));
    const rows = [];
    const news = [];

    for (const feed of feeds) {
        const host = siteOf(feed.url);
        const language = feed.language ?? profile.languages[0];
        const found = (await googleSearch([`site:${host}`], language)).news
            .filter(item => !item.publishedAt || new Date(item.publishedAt) >= since);
        news.push(...found);
        const ours = await ourArticles(feed.url);

        const google = found.map(item => ({...item, words: words(item.title)}));
        const delays = [];
        let matched = 0;
        for (const article of ours) {
            const own = words(article.title);
            const twin = google.find(item => jaccard(own, item.words) >= TITLES_MATCH);
            if (!twin) continue;
            matched++;
            // positive: Google had it before we read it through the bridge
            if (twin.publishedAt) delays.push((new Date(article.created_at) - new Date(twin.publishedAt)) / 60e3);
        }
        rows.push({
            site: host,
            ours: ours.length,
            google: found.length,
            both: matched,
            onlyGoogle: found.length - matched,
            onlyOurs: ours.length - matched,
            medianMinutesAhead: median(delays) === null ? null : Math.round(median(delays)),
        });
    }

    console.table(rows);
    results.sites = rows;
    return news;
};

// ---- decode -----------------------------------------------------------------------------------

// the id of an article in a Google News link: ".../rss/articles/CBMi...?oc=5"
const articleId = (link) => new URL(link).pathname.split('/').pop();

// its signature and time, written in the page of the article on Google News. pageMs: how long each
// page took, without the wait between two requests
const pageMs = [];
let requested = 0;
const signatureOf = async (id) => {
    for (const url of [`https://news.google.com/articles/${id}`, `https://news.google.com/rss/articles/${id}`]) {
        const start = Date.now();
        const res = await polite(() => {
            requested = Date.now();
            return fetch(url, {headers: {'User-Agent': BROWSER}, redirect: 'follow'});
        });
        pageMs.push(Date.now() - Math.max(start, requested));
        if (res.status === 429) throw new Blocked('429 on an article page');
        if (/consent\.google|sorry\/index/.test(res.url)) throw new Blocked(`redirected to ${new URL(res.url).host}${new URL(res.url).pathname}`);
        if (!res.ok) continue;
        const html = await res.text();
        const signature = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
        const timestamp = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
        if (signature && timestamp) return {signature, timestamp};
    }
    return null;
};

// the real addresses of several articles in one request, in their order. Google answers them in any
// order: each call is numbered, and its answer carries the number back (entry[6])
const resolve = async (articles) => {
    const request = [articles.map(({id, timestamp, signature}, i) => ['Fbv4je',
        `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${timestamp},"${signature}"]`,
        null, String(i + 1)])];
    const res = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': BROWSER},
        body: `f.req=${encodeURIComponent(JSON.stringify(request))}`,
    });
    if (res.status === 429) throw new Blocked('429 on batchexecute');
    if (!res.ok) throw new Error(`batchexecute answered ${res.status}`);

    const [, payload] = (await res.text()).split('\n\n');
    const urls = new Array(articles.length).fill(null);
    for (const entry of JSON.parse(payload)) {
        if (entry[0] !== 'wrb.fr' || typeof entry[2] !== 'string') continue;
        urls[Number(entry[6]) - 1] = JSON.parse(entry[2])[1];
    }
    return urls;
};

const decode = async (news) => {
    const count = Number(options.decode);
    console.log(`\n== Decoding ${count} Google News links ==`);
    const sample = news.slice(0, count);
    const signed = [];
    let unsigned = 0;

    for (const item of sample) {
        const id = articleId(item.url);
        const signature = await signatureOf(id);
        if (signature) signed.push({...item, id, ...signature});
        else unsigned++;
    }

    let start = 0;
    const urls = signed.length > 0 ? await polite(async () => {
        start = Date.now();
        return resolve(signed);
    }) : [];
    const resolveMs = Date.now() - start;

    const decoded = signed.map((item, i) => ({site: item.site, title: item.title, url: urls[i] ?? null}));
    const right = decoded.filter(item => item.url && nameOf(siteOf(item.url)) === nameOf(item.site));
    const summary = {
        tried: sample.length,
        noSignature: unsigned,
        answered: urls.filter(Boolean).length,
        rightMedium: right.length,
        medianPageMs: median(pageMs),
        batchMs: resolveMs,
    };
    console.table(summary);
    for (const item of decoded.slice(0, 5)) console.log(`  ${item.site}  ->  ${item.url}`);
    results.decode = {summary, decoded};
};

// ---- run --------------------------------------------------------------------------------------

try {
    const profile = await ProfileModel.get(userId);
    if (!profile) throw new Error(`User ${userId} has no profile.`);
    const feedUrls = [...new Set([
        ...profile.languages.flatMap(language => Object.values(rss[language] ?? {}).flat()),
        ...await FeedModel.userFeedUrls(userId),
    ])];

    const news = [];
    if (parts.has('coverage')) {
        try {
            news.push(...await coverage(profile, feedUrls));
        } catch (err) {
            if (err instanceof Blocked) throw err;
            console.error(`Coverage not measured: ${err.message}`);
        }
    }
    if (parts.has('sites')) news.push(...await sites(profile));
    if (parts.has('decode')) {
        if (news.length === 0) news.push(...(await googleSearch(['football'], profile.languages[0])).news);
        await decode(news);
    }
} catch (err) {
    if (err instanceof Blocked) {
        console.error(`\nGoogle blocked the measure (${err.message}): stopped, after ${results.requests} requests.`);
        results.blocked = err.message;
    } else {
        console.error(err.stack ?? err);
        results.error = err.message;
    }
} finally {
    fs.mkdirSync(OUT, {recursive: true});
    const file = path.join(OUT, `measure-${results.at.slice(0, 16).replace(/[:T]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify(results, null, 2));
    console.log(`\n${results.requests} requests to Google. Results in ${path.relative(process.cwd(), file)}`);
    await prisma.$disconnect();
}
