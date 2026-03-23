"use strict"

import Links from "./links.js";
import {Scraper} from "./scraper.js";

const News = {
    async fetch({keywords, categories, undesiredTopics, language, timeframe}) {
        try {
            // Get links from categories
            const newsLinks = Links.getCategoriesLinks(categories);

            // Get news
            return await Scraper.Handler(keywords, newsLinks);
        } catch (err) {
            console.log(`Error fetching news for ${categories}: ${err}`);
            throw err;
        }
    }
}

export default News;