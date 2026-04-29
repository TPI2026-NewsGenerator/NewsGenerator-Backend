"use strict"

import {BasicCrawler, CheerioCrawler, Configuration, KeyValueStore, log, RequestQueue} from 'crawlee';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { Parser } from "./parser.js";


export const Crawlers = {
    // inspired by "https://crawlee.dev/js/docs/examples/basic-crawler"
    Xml: async (urls) => {
        let scrapedNews = [];

        // remove storage functionality
        // Configuration.getGlobalConfig().set('purgeOnStart', true);
        await RequestQueue.open().then(queue => queue.drop());
        await KeyValueStore.open().then(store => store.drop());

        // used basic crawler since it is for XML content
        const crawler = new BasicCrawler({
            minConcurrency: 20,
            maxConcurrency: 50,
            maxRequestRetries: 1,
            requestHandlerTimeoutSecs: 30,
            maxRequestsPerCrawl: 10,

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

        // Configuration.getGlobalConfig().set('purgeOnStart', true);
        await RequestQueue.open().then(queue => queue.drop());
        await KeyValueStore.open().then(store => store.drop());

        const crawler = new CheerioCrawler({
            minConcurrency: 20,
            maxConcurrency: 50,
            maxRequestRetries: 1,
            requestHandlerTimeoutSecs: 30,
            maxRequestsPerCrawl: 10,

            async requestHandler({ request, body }) {
                const { document } = parseHTML(body);   // structure html DOM
                const reader = new Readability(document); // parse HTML from linkedom document
                const newsContent = reader.parse(); // parse useful content

                const { thumbnail } = request.userData;

                // format data
                scrapedContentNews.push({
                    url: request.url ?? null,
                    thumbnail: thumbnail ?? null,
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