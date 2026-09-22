//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: news-controller.js
//  Description: Controller for news feature
//

"use strict"

import {NewsService, MAX_SELECTED_NEWS} from '../services/news-service.js';
import {FeedService} from '../services/feed-service.js';

// validate the urls of the selected news, then answer with the result of 'serviceFn'
const respondWithSelectedNews = async (req, res, serviceFn) => {
    const {urls} = req.body;

    // validate data
    if (!Array.isArray(urls) || urls.length === 0 || !urls.every(url => typeof url === 'string')) {
        return res.status(400).json({error: "Please select at least one news."});
    }

    const uniqueUrls = [...new Set(urls)];
    if (uniqueUrls.length > MAX_SELECTED_NEWS) {
        return res.status(400).json({error: `${MAX_SELECTED_NEWS} news max.`});
    }

    try {
        const news = await serviceFn(uniqueUrls);
        res.status(200).json({
            totalResults: news.length,
            news: news
        });
    } catch (error) {
        res.status(error.status || 500).json({error: error.message ?? error});
    }
};

export const NewsController = {
    getNews: async (req, res) => {
        const filters = req.body;

        // authorized filters
        const authorizedFilters = ['keywords', 'category', 'language', 'timeframe'];
        for (let filter in filters) {
            if (!authorizedFilters.find(element => element === filter)) {
                const err = new Error(`Filter ${filter} is not authorized.`);
                err.status = 400;
                throw err;
            }
        }

        const {keywords, category, language, timeframe} = filters;

        // validate data
        if (keywords === undefined || keywords.length === 0) {
            const err = new Error("No keywords were inserted, please enter at least one.")
            err.status = 400;
            throw err;
        }

        if (category === undefined || category.length === 0) {
            const err = new Error("No categories selected, please select at least one category.")
            err.status = 400;
            throw err;
        }

        // timeframe: {start, end} ISO dates, both optional ("not older than 24h" is a start only)
        const timeframeDates = {};
        for (let bound of ['start', 'end']) {
            if (timeframe?.[bound] === undefined || timeframe[bound] === '') continue;

            const date = new Date(timeframe[bound]);
            if (isNaN(date)) {
                const err = new Error(`Timeframe ${bound} is not a valid date.`);
                err.status = 400;
                throw err;
            }
            timeframeDates[bound] = date;
        }

        // not used for the moment
        // const authorizedLang = ['en', 'fr', 'es', 'ch', 'ru'];
        // if (language !== undefined || language !== "") {
        //     if (!authorizedLang.find(element => element === language)) {
        //         const err = new Error(`Language ${language} is not authorized.`);
        //         err.status = 400;
        //         throw err;
        //     }
        // }

        try {
            const news = await NewsService.getNews({keywords, category, timeframe: timeframeDates, userId: req.user?.id});
            res.status(200).json(news);
        } catch (error) {
            if (typeof(error) === 'string' && error.includes("None of theses categories were found:")) {
                res.status(400).json({error: error});
            } else {
                res.status(500).json({error: error});
            }
        }
    },

    getCategories: async (req, res) => {
        res.status(200).json({categories: FeedService.categories()});
    },

    getNewsContent: async (req, res) => {
        await respondWithSelectedNews(req, res, NewsService.getNewsContent);
    },

    getNewsSummary: async (req, res) => {
        await respondWithSelectedNews(req, res, NewsService.getNewsSummary);
    },
}
