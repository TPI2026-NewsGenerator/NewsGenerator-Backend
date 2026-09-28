//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: crawlers.js
//  Description: XML fetcher and CheerioCrawler from Crawlee
//

"use strict"

import {CheerioCrawler, Configuration, log} from 'crawlee';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { Parser } from "./parser.js";
import { mapWithConcurrency } from "./concurrency.js";
import { fetchPublicUrl, isBridgeUrl } from "./public-url.js";

const XML_CONCURRENCY = 50;       // number of feeds fetched at the same time
const XML_TIMEOUT_MS = 8000;      // a slow feed is abandoned after this delay
const BRIDGE_TIMEOUT_MS = 40000;  // a built feed is slower: the bridge reads the site page by page
const USER_AGENT = 'Mozilla/5.0 (compatible; NewsGenerator/1.0; +RSS reader)';

// The blocks of an article as its page sets them: the key passages are cut in sentences inside a
// block, so a heading or a caption is never glued to the sentence after it ("…09h53Une sortie à vélo"),
// and a quote stays known as a quote. Only the innermost blocks, a list item holding a paragraph is
// that paragraph
const BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, pre, dt, dd';
const blockKind = (element) => {
    const tag = element.tagName.toUpperCase();
    if (/^H\d$/.test(tag)) return 'heading';
    if (tag === 'FIGCAPTION' || element.closest('figure')) return 'caption';
    if (tag === 'BLOCKQUOTE' || element.closest('blockquote')) return 'quote';
    return 'text';
};
export const blocksOf = (html) => {
    if (!html) return [];
    const {document} = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
    return [...document.querySelectorAll(BLOCKS)]
        .filter(element => !element.querySelector(BLOCKS))
        .map(element => ({kind: blockKind(element), text: element.textContent.replace(/\s+/g, ' ').trim()}))
        .filter(block => block.text);
};

// download and parse one feed, the server answers 304 if it did not change since the last etag / last-modified
// the address is checked at every refresh, not only when a user adds a feed: a name that was public
// can point to a private address later, and a feed can redirect to one
const fetchFeed = async ({url, etag, lastModified}) => {
    const headers = {
        'User-Agent': USER_AGENT,
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
    };
    if (etag) headers['If-None-Match'] = etag;
    if (lastModified) headers['If-Modified-Since'] = lastModified;

    // a feed built by our own RSS-Bridge answers on this machine, and it reads one page per article
    const bridge = isBridgeUrl(url);
    const { res } = await fetchPublicUrl(url, {
        headers,
        timeoutMs: bridge ? BRIDGE_TIMEOUT_MS : XML_TIMEOUT_MS,
        trusted: bridge,
    });

    if (res.status === 304) return { notModified: true, items: [] };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    return {
        notModified: false,
        items: await Parser.Xml(await res.text()),
        etag: res.headers.get('etag'),
        lastModified: res.headers.get('last-modified'),
    };
};

export const Crawlers = {
    // Crawlee is not needed for RSS feeds: a plain fetch in parallel is faster and has no shared storage
    // feeds: [{url, etag?, lastModified?}], returns one result per feed, in the same order
    Xml: async (feeds) => {
        const results = await mapWithConcurrency(feeds, XML_CONCURRENCY, fetchFeed);

        return results.map((result, i) => {
            if (result.status === 'fulfilled') return { url: feeds[i].url, ...result.value };

            const error = result.reason?.message ?? String(result.reason);
            log.debug(`Feed ${feeds[i].url} failed: ${error}`);
            return { url: feeds[i].url, error, items: [] };
        });
    },

    Html: async (urls) => {
        let scrapedContentNews = [];

        const crawler = new CheerioCrawler({
            minConcurrency: 10,
            maxConcurrency: 50,
            maxRequestRetries: 1,
            requestHandlerTimeoutSecs: 30,

            async requestHandler({ request, body }) {
                const { document } = parseHTML(body.toString());   // structure html DOM
                const reader = new Readability(document); // parse HTML from linkedom document
                const newsContent = reader.parse(); // parse useful content

                // page without readable content (video, paywall...)
                if (!newsContent) return;

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
                    blocks: blocksOf(newsContent.content),

                })
            },

            // This function is called if the page processing failed more than maxRequestRetries + 1 times.
            failedRequestHandler({ request }) {
                log.debug(`Request ${request.url} failed twice.`);
            },
        // own in-memory storage for each run, so two simultaneous API calls don't share the same queue
        }, new Configuration({ persistStorage: false }));

        // trigger crawlee with links
        await crawler.run(urls);

        return scrapedContentNews;
    }
}
