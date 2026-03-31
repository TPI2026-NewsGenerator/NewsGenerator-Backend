"use strict"

import {NewsService} from '../services/news-service.js';

export const NewsController = {
    getNews: async (req, res) => {
        const filters = req.body;

        // authorized filters
        const authorizedFilters = ['keywords', 'category', 'undesiredTopics', 'language', 'timeframe'];
        for (let filter in filters) {
            if (!authorizedFilters.find(element => element === filter)) {
                const err = new Error(`Filter ${filter} is not authorized.`);
                err.status = 400;
                throw err;
            }
        }

        const {keywords, category, undesiredTopics, language, timeframe} = filters;

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

}