"use strict"

import Links from "./links.js";
import {scrapNews} from "./scraper.js";

const News = {
    async fetch({keywords, categories, undesiredTopics, language, timeframe}) {
        try {
            // Get links from categories
            const newsLinks = Links.getCategoriesLinks(categories);

            // Get news
            return await scrapNews(keywords, newsLinks);
        } catch (err) {
            console.log(`Error fetching news for ${categories}: ${err}`);
            throw err;
        }
    }
}

export default News;