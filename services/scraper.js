import {BasicCrawler, CheerioCrawler, log} from 'crawlee';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { xmlParse } from "./xmlParser.js";


// main scrap function
export const scrapNews = async (keywords, urls) => {
    const scrappedXml = await scrapXml(urls, keywords);
    const scrapedXmlLinks = scrappedXml.map(news => news.link ?? null)
    const newsContent = await scrapHtml(scrapedXmlLinks);

    return newsContent || [];
}

// inspired by "https://crawlee.dev/js/docs/examples/basic-crawler"
async function scrapXml(urls, keywords) {
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

    // return filtered news if found
    const filteredNews = filterNews(fetchedNews.flat(), keywords);
    if (filteredNews.length > 0) return filteredNews;

    return fetchedNews;
}

// inspired by "https://crawlee.dev/js/api/cheerio-crawler/class/CheerioCrawler"
async function scrapHtml(urls){
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
                site: newsContent.siteName ?? '',
                publishedTime: newsContent.publishedTime ?? '',
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

// filter news on category and title
const filterNews = (newsList, keywords) => {
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