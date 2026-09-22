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
const AI_CONCURRENCY = 5;   // resumes asked to Ollama at the same time

// site name from the article link, e.g. "https://www.nytimes.com/..." -> "nytimes.com"
const sourceOf = (link) => {
    try {
        return new URL(link).hostname.replace(/^www\./, '');
    } catch {
        return '';
    }
};

// cached article -> format sent to the client
const toNews = (article) => ({
    url: article.link,
    thumbnail: article.thumbnail,
    source: sourceOf(article.link),
    publishedAt: article.published_at?.toISOString() ?? '',
    title: article.title,
    description: article.description,
    topic: article.topic,
});

export const NewsService = {
    // news list for the selection, read only from the RSS cache (no page is scraped here)
    getNews: async ({keywords, category, topics = [], undesiredTopics = [], language, timeframe}) => {
        try {
            // 1. get links from categories
            const newsLinks = Links.getCategoriesLinks(category);

            // 2. search the cached news of these feeds (filled in background by FeedService), filtered in SQL
            await FeedService.ready();
            const articles = await FeedModel.searchArticles({
                feedUrls: newsLinks,
                topics,
                undesiredTopics,
                keywordGroups: Filter.parse(keywords),
            });
            if (articles.length === 0) return [];

            // 3. once per link (a news can be in several feeds)
            const news = [...new Map(articles.map(article => [article.link, toNews(article)])).values()];

            return {
                totalResults: news.length,
                news: news
            }
        } catch (err) {
            console.log(`Error fetching news for ${category}: ${err}`);
            throw err;
        }
    },

    // full content of the news selected by the user, scraped only now
    getNewsContent: async (urls) => {
        // only links from the cache can be scraped, so the API can't be used to fetch any url
        const cachedArticles = await FeedModel.getArticlesByLinks(urls);
        const articles = new Map(cachedArticles.map(article => [article.link, article]));

        const unknownUrls = urls.filter(url => !articles.has(url));
        if (unknownUrls.length > 0) {
            const err = new Error(`Unknown news: ${unknownUrls.join(', ')}`);
            err.status = 400;
            throw err;
        }

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

    // AI resume of the news selected by the user
    getNewsSummary: async (urls) => {
        const newsList = await NewsService.getNewsContent(urls);

        const results = await mapWithConcurrency(newsList, AI_CONCURRENCY, async (news) => {
            // the RSS description is too short, the AI would invent the rest
            if (!news.fullContent) return null;
            return ollamaResume(news.title, news.content);
        });

        return newsList.map((news, i) => {
            const result = results[i];
            let summaryError = null;

            if (result.status === 'rejected') {
                console.log(`AI resume failed for ${news.url}: ${result.reason}`);
                summaryError = "The AI could not summarize this news, please try again.";
            } else if (result.value === null) {
                summaryError = "This news could not be read (paywall or protected site), no resume generated.";
            }

            return {
                ...news,
                summary: result.status === 'fulfilled' ? result.value : null,
                summaryError: summaryError,
            };
        });
    }
}
