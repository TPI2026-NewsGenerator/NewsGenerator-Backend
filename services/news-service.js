"use strict"

import Links from "./utils/links.js";
import {Crawlers} from "./utils/crawlers.js";
import {Filter} from "./utils/filter.js";

export const NewsService = {
    getNews: async ({keywords, category, undesiredTopics, language, timeframe}) => {
        try {
            // 1. get links from categories
            const newsLinks = Links.getCategoriesLinks(category);

            // 2. scrap XML
            const scrappedXml = await Crawlers.Xml(newsLinks, keywords);

            // 3. filter news
            const filteredNews = Filter.News(scrappedXml, keywords);
            if (filteredNews.length > 0) {
                const scrapedXmlLinks = scrappedXml
                    .filter(news => news?.link)
                    .map(news => ({
                        url: news.link,
                        userData: {
                            thumbnail: news.thumbnail
                        }
                    }))

                // 4. get full news content of filtered news and return it
                const news = await Crawlers.Html(scrapedXmlLinks);
                return {
                    totalResults: news.length,
                    news: news
                }
            }

            return [];
        } catch (err) {
            console.log(`Error fetching news for ${category}: ${err}`);
            throw err;
        }
    }
}