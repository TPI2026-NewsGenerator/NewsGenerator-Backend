//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: news-controller.js
//  Description: Controller for news feature
//

"use strict"

import {NewsService, MAX_SELECTED_NEWS} from '../services/news-service.js';
import {TOPICS, topicsError} from '../services/utils/topics.js';

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
        const authorizedFilters = ['keywords', 'category', 'topics', 'undesiredTopics', 'language', 'timeframe'];
        for (let filter in filters) {
            if (!authorizedFilters.find(element => element === filter)) {
                const err = new Error(`Filter ${filter} is not authorized.`);
                err.status = 400;
                throw err;
            }
        }

        const {keywords, category, topics, undesiredTopics, language, timeframe} = filters;

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

        const topicsErrorMessage = topicsError(topics, undesiredTopics);
        if (topicsErrorMessage) {
            const err = new Error(topicsErrorMessage)
            err.status = 400;
            throw err;
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
            const news = await NewsService.getNews(req.body);
            res.status(200).json(news);
        } catch (error) {
            if (typeof(error) === 'string' && error.includes("None of theses categories were found:")) {
                res.status(400).json({error: error});
            } else {
                res.status(500).json({error: error});
            }
        }
    },

    getTopics: async (req, res) => {
        res.status(200).json({topics: TOPICS});
    },

    getNewsContent: async (req, res) => {
        await respondWithSelectedNews(req, res, NewsService.getNewsContent);
    },

    getNewsSummary: async (req, res) => {
        await respondWithSelectedNews(req, res, NewsService.getNewsSummary);
    },
}
