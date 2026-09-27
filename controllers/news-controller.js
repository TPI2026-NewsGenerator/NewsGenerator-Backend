//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: news-controller.js
//  Description: Controller for news feature
//

"use strict"

import {NewsService, MAX_SELECTED_NEWS, MAX_STORY_ARTICLES} from '../services/news-service.js';
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

        // a search reads the sources of one language, the categories of db/rss-links.js are filed
        // under it: asking for a language we have no source for gives nothing, so it is refused here
        const searched = language || 'en';
        if (!FeedService.languages().includes(searched)) {
            const err = new Error(`No source in "${searched}" yet. Available: ${FeedService.languages().join(', ')}.`);
            err.status = 400;
            throw err;
        }

        try {
            const news = await NewsService.getNews({
                keywords,
                category,
                timeframe: timeframeDates,
                userId: req.user?.id,
                language: searched,
            });
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
        res.status(200).json({
            categories: FeedService.categories(req.query.language || 'en'),
            languages: FeedService.languages(),
        });
    },

    getNewsContent: async (req, res) => {
        await respondWithSelectedNews(req, res, NewsService.getNewsContent);
    },

    // body: {stories: [{urls}], language}, the cards chosen with their articles, the lead first.
    // {urls} alone is still read, one card per url
    getNewsSummary: async (req, res) => {
        const {language = 'en'} = req.body;
        const stories = Array.isArray(req.body.stories)
            ? req.body.stories
            : Array.isArray(req.body.urls) ? req.body.urls.map(url => ({urls: [url]})) : null;

        const valid = (story) => Array.isArray(story?.urls) && story.urls.length > 0
            && story.urls.length <= MAX_STORY_ARTICLES && story.urls.every(url => typeof url === 'string');
        if (!stories || stories.length === 0 || !stories.every(valid)) {
            return res.status(400).json({error: "Please select at least one news."});
        }
        // the same card chosen twice is one card
        const unique = [...new Map(stories.map(story => [story.urls[0], {urls: [...new Set(story.urls)]}])).values()];
        if (unique.length > MAX_SELECTED_NEWS) {
            return res.status(400).json({error: `${MAX_SELECTED_NEWS} news max.`});
        }
        if (typeof language !== 'string' || !FeedService.languages().includes(language)) {
            return res.status(400).json({error: `Unknown language: ${language}`});
        }

        try {
            const news = await NewsService.summarizeStories(unique, {userId: req.user?.id, language});
            res.status(200).json({totalResults: news.length, news});
        } catch (error) {
            res.status(error.status || 500).json({error: error.message ?? error});
        }
    },
}
