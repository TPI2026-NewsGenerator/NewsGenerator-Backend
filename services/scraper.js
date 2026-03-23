"use strict"

import { BasicCrawler, CheerioCrawler, log } from 'crawlee';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { xmlParse } from "./xmlParser.js";
import { Filter } from './filter.js'


export const Scraper = {
    // main scrap function
    Handler: async (keywords, urls) => {
        // 1. scrap XML
        const scrappedXml = await this.Xml(urls, keywords);

        // 2. return filtered news if found
        const filteredNews = Filter.News(scrappedXml, keywords);
        if (filteredNews.length > 0) {
            const scrapedXmlLinks = scrappedXml.map(news => news.link ?? null)
            // 3. get full news content of filtered news
            const newsContent = await this.Html(scrapedXmlLinks);
            return {
                totalResults: newsContent.length,
                articles: {newsContent}
            }
        }

        return [];
    },

    // inspired by "https://crawlee.dev/js/docs/examples/basic-crawler"
    Xml: async (urls) => {
        let fetchedNews = [];

        // used basic crawler since it is for xml content
        const crawler = new BasicCrawler({
            minConcurrency: 20,
            maxConcurrency: 50,
            maxRequestRetries: 1,
            requestHandlerTimeoutSecs: 30,
            // maxRequestsPerCrawl: 10,

            async requestHandler({ sendRequest }) {
                const { body } = await sendRequest();

                const xmlParsed = await xmlParse(body)

                fetchedNews.push(xmlParsed);
            },

            // This function is called if the page processing failed more than maxRequestRetries + 1 times.
            failedRequestHandler({ request }) {
                log.debug(`Request ${request.url} failed twice.`);
            },
        });

        // trigger crawlee with links
        await crawler.run(urls);

        return fetchedNews.flat();
    },

    // inspired by "https://crawlee.dev/js/api/cheerio-crawler/class/CheerioCrawler"
    Html: async (urls) => {
        let fetchedContentNews = [];

        const crawler = new CheerioCrawler({
            minConcurrency: 20,
            maxConcurrency: 50,
            maxRequestRetries: 1,
            requestHandlerTimeoutSecs: 30,
            // maxRequestsPerCrawl: 10,

            async requestHandler({ request, body }) {
                const { document } = parseHTML(body);   // structure html DOM
                const reader = new Readability(document); // parse HTML from linkedom document
                const newsContent = reader.parse(); // parse useful content

                // format data
                fetchedContentNews.push({
                    url: request.url ?? null,
                    source: newsContent.siteName ?? '',
                    publishedAt: newsContent.publishedTime ?? '',
                    title: newsContent.title ?? '',
                    author: newsContent.byline ?? '',
                    lang: newsContent.lang ?? '',
                    description: newsContent.excerpt ?? '',
                    content: newsContent.textContent?.trim() || '',

                })
            },

            // This function is called if the page processing failed more than maxRequestRetries + 1 times.
            failedRequestHandler({ request }) {
                log.debug(`Request ${request.url} failed twice.`);
            },
        });

        // trigger crawlee with links
        await crawler.run(urls);

        return fetchedContentNews;
    }
}

// filter news on category and title
export const filterNews = (newsList, keywords) => {
    let filteredNews = [];
    if (keywords[0] && keywords[0].trim() !== ''){
        for (let news of newsList) {
            // check if category corresponds
            if (!news || !news.category) continue;
            for (let keyword of keywords) {
                // Check filter in category array
                if (Array.isArray(news.category)) {
                    for (let category of news.category ?? []) {
                        if (category.toLowerCase().includes(keyword.toLowerCase())) {
                            filteredNews.push(news);
                        }
                    }
                // Check filter in category word (if only 1 category)
                } else if (news.category.toLowerCase().includes(keyword.toLowerCase())) {
                    filteredNews.push(news);
                }

                // // Check filter in description
                // if (news.description.toLowerCase().includes(keyword.toLowerCase())) {
                //     filteredNews.push(news);
                // }
                // Check filter in title
                if (news.title.toLowerCase().includes(keyword.toLowerCase()) && !filteredNews.includes(news)) {
                    filteredNews.push(news);
                }
            }
        }
    }

    return filteredNews;
}