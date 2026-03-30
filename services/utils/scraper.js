"use strict"

import { BasicCrawler, CheerioCrawler, log } from 'crawlee';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { Parser } from "./parser.js";


export const Scraper = {
    // inspired by "https://crawlee.dev/js/docs/examples/basic-crawler"
    Xml: async (urls) => {
        let scrapedNews = [];

        // used basic crawler since it is for XML content
        const crawler = new BasicCrawler({
            minConcurrency: 20,
            maxConcurrency: 50,
            maxRequestRetries: 1,
            requestHandlerTimeoutSecs: 30,
            // maxRequestsPerCrawl: 10,

            async requestHandler({ sendRequest }) {
                const { body } = await sendRequest();

                const xmlParsed = await Parser.Xml(body)

                scrapedNews.push(xmlParsed);
            },

            // This function is called if the page processing failed more than maxRequestRetries + 1 times.
            failedRequestHandler({ request }) {
                log.debug(`Request ${request.url} failed twice.`);
            },
        });

        // trigger crawlee with links
        await crawler.run(urls);

        return scrapedNews.flat();
    },

    // inspired by "https://crawlee.dev/js/api/cheerio-crawler/class/CheerioCrawler"
    Html: async (urls) => {
        let scrapedContentNews = [];

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
                scrapedContentNews.push({
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

        return scrapedContentNews;
    }
}