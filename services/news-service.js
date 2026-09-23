//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: news-service.js
//  Description: Service for news feature
//

"use strict"

import Links from "./utils/links.js";
import {Crawlers} from "./utils/crawlers.js";
import {Filter} from "./utils/filter.js";
import {FeedService} from "./feed-service.js";
import {FeedModel} from "../models/feed-model.js";
import {ollamaResume} from "./utils/ollama.js";
import {mapWithConcurrency} from "./utils/concurrency.js";

export const MAX_SELECTED_NEWS = 10;
const AI_CONCURRENCY = 5;       // resumes asked to Ollama at the same time
const SIMILARITY = 0.45;        // above this, two titles tell the same news (trigram similarity)
const MIN_RESULTS = 5;          // under this, a search asking for every word is asked again for any of them

// site name from the article link, e.g. "https://www.nytimes.com/..." -> "nytimes.com"
const sourceOf = (link) => {
    try {
        return new URL(link).hostname.replace(/^www\./, '');
    } catch {
        return '';
    }
};

// a feed built from a page (see feed-bridge.js) gives the whole article as its description, where a
// published feed gives a few lines. The card only shows the beginning, the whole text stays in the
// database for the search to read.
const CARD_LENGTH = 400;
const shorten = (text) => !text || text.length <= CARD_LENGTH
    ? text
    : text.slice(0, CARD_LENGTH).replace(/\s+\S*$/, '') + '…';

// cached article -> format sent to the client
const toNews = (article) => ({
    url: article.link,
    thumbnail: article.thumbnail,
    source: sourceOf(article.link),
    publishedAt: article.published_at?.toISOString() ?? '',
    title: article.title,
    description: shorten(article.description),
    topic: article.topic,
});

// group the articles telling the same news: the most recent one is kept and the others become its
// 'sources', so the user doesn't see the same news ten times
const groupDuplicates = async (articles) => {
    const pairs = await FeedModel.similarArticlePairs(articles.map(article => article.id), SIMILARITY);

    // union-find: every article of a group points to the first article of that group
    const groupOf = new Map(articles.map(article => [article.id, article.id]));
    const find = (id) => {
        while (groupOf.get(id) !== id) id = groupOf.get(id);
        return id;
    };
    for (let {id_a, id_b} of pairs) {
        const [a, b] = [find(id_a), find(id_b)];
        if (a !== b) groupOf.set(b, a);
    }

    const news = new Map();     // group -> news sent to the client
    for (let article of articles) {
        const group = find(article.id);

        if (!news.has(group)) {
            news.set(group, {...toNews(article), sources: []});
        } else {
            const {url, source, title, publishedAt} = toNews(article);
            news.get(group).sources.push({url, source, title, publishedAt});
        }
    }

    return [...news.values()];
};

export const NewsService = {
    // news list for the selection, read from the RSS cache (no page scraped, no AI)
    getNews: async ({keywords, category, timeframe, userId, language = 'en'}) => {
        try {
            // 1. get links from categories, with the feeds this user added (private to them)
            const newsLinks = [...new Set([
                ...Links.getCategoriesLinks(category, language),
                ...(userId ? await FeedModel.userFeedUrls(userId, category) : []),
            ])];

            // 2. fetch the feeds only if the cache is too old
            await FeedService.ensureFresh(userId, language);

            // 3. search in SQL: keywords, excluded keywords (-word) and publication date
            const search = (parsed) => FeedModel.searchArticles({
                feedUrls: newsLinks,
                keywords: parsed,
                timeframe: timeframe,
            });

            const parsed = Filter.parse(keywords);
            const articles = await search(parsed);

            // "referee football soccer" asks for the three words in the same news, and almost none
            // has all three. Written like that in a web search it would only rank, never remove.
            // So when a search finds close to nothing, the wider one is counted and offered, not
            // done: widening "red card" on its own would answer everything about red or about card.
            let wider = null;
            if (articles.length < MIN_RESULTS && Filter.canWiden(parsed)) {
                const loose = Filter.widen(parsed);
                const found = await search(loose);

                if (found.length > articles.length) {
                    wider = {
                        found: found.length,
                        terms: loose.groups.map(([term]) => term.text),
                    };
                }
            }

            if (articles.length === 0) return {totalResults: 0, news: [], wider};

            // 4. once per link (a news can be in several feeds), then group the news telling the same story
            const uniqueArticles = [...new Map(articles.map(article => [article.link, article])).values()];
            const news = await groupDuplicates(uniqueArticles);

            return {
                totalResults: news.length,
                news: news,
                wider: wider,
            }
        } catch (err) {
            console.log(`Error fetching news for ${category}: ${err}`);
            throw err;
        }
    },

    // articles of the cache for these urls, refuses an url that is not in the cache so the API
    // can't be used to scrape or summarize any page
    cachedArticles: async (urls) => {
        const articles = new Map((await FeedModel.getArticlesByLinks(urls)).map(article => [article.link, article]));

        const unknownUrls = urls.filter(url => !articles.has(url));
        if (unknownUrls.length > 0) {
            const err = new Error(`Unknown news: ${unknownUrls.join(', ')}`);
            err.status = 400;
            throw err;
        }

        return articles;
    },

    // full content of the news selected by the user, scraped only now
    getNewsContent: async (urls) => {
        const articles = await NewsService.cachedArticles(urls);

        const scraped = await Crawlers.Html(urls.map(url => ({
            url: url,
            userData: { thumbnail: articles.get(url).thumbnail }
        })));
        const contents = new Map(scraped.map(page => [page.url, page]));

        // same order as asked, RSS description used when the page can't be read (paywall, 403...)
        return urls.map(url => {
            const news = toNews(articles.get(url));
            const page = contents.get(url);

            return {
                ...news,
                author: page?.author ?? '',
                lang: page?.lang ?? '',
                content: page?.content || news.description,
                fullContent: Boolean(page?.content),
            };
        });
    },

    // AI resume and topic of the news selected by the user, kept in the cache for the next requests
    getNewsSummary: async (urls) => {
        const articles = await NewsService.cachedArticles(urls);

        // a news already summarized costs nothing
        const toSummarize = urls.filter(url => !articles.get(url).summary);
        const contents = new Map(
            (toSummarize.length > 0 ? await NewsService.getNewsContent(toSummarize) : [])
                .map(news => [news.url, news])
        );

        const results = await mapWithConcurrency(toSummarize, AI_CONCURRENCY, async (url) => {
            const news = contents.get(url);
            // the RSS description is too short, the AI would invent the rest
            if (!news.fullContent) return null;

            const {summary, topic} = await ollamaResume(news.title, news.content);
            await FeedModel.saveSummary(url, summary, topic);
            return {summary, topic};
        });
        const summaries = new Map(toSummarize.map((url, i) => [url, results[i]]));

        return urls.map(url => {
            const article = articles.get(url);
            const news = toNews(article);

            if (article.summary) return {...news, summary: article.summary, summaryError: null};

            const result = summaries.get(url);
            if (result.status === 'rejected') {
                console.log(`AI resume failed for ${url}: ${result.reason}`);
                return {...news, summary: null, summaryError: "The AI could not summarize this news, please try again."};
            }
            if (result.value === null) {
                return {...news, summary: null, summaryError: "This news could not be read (paywall or protected site), no resume generated."};
            }

            return {...news, topic: result.value.topic, summary: result.value.summary, summaryError: null};
        });
    }
}
