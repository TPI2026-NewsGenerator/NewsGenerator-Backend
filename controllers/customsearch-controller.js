//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: customsearch-controller.js
//  Description: Controller for custom searches feature
//

"use strict"

import {CustomSearchService} from '../services/customsearch-service.js';
import {topicsError} from '../services/utils/topics.js';

export const CustomSearchController = {
    getUserCustomSearch: async (req, res) => {
        // the user id comes from the verified token, never from the request
        const userId = req.user?.id;

        if (!userId) {
            const err = new Error(`An id is required...`);
            err.status = 400;
            throw err;
        }

        try {
            const customSearch = await CustomSearchService.getUserCustomSearch({userId});
            res.status(200).json(customSearch);
        } catch (error) {
            if (typeof(error) === 'string' && error.includes("None of theses custom searches were found:")) {
                res.status(400).json({error: error});
            } else {
                res.status(500).json({error: error});
            }
        }
    },
    postUserCustomSearch: async (req, res) => {
        const {id, title, keyword, language, category, topics, undesiredTopics} = req.body;
        const userId = req.user?.id;
        if (!userId) {
            const err = new Error(`An id is required...`);
            err.status = 400;
            throw err;
        }

        if (!title) {
            const err = new Error(`A title is required...`);
            err.status = 400;
            throw err;
        }

        if (!keyword) {
            const err = new Error(`A keyword is required...`);
            err.status = 400;
            throw err;
        }

        if (!language) {
            const err = new Error(`A language is required...`);
            err.status = 400;
            throw err;
        }

        if (!category || category.length === 0) {
            const err = new Error(`A category is required...`);
            err.status = 400;
            throw err;
        }

        const topicsErrorMessage = topicsError(topics, undesiredTopics);
        if (topicsErrorMessage) {
            const err = new Error(topicsErrorMessage);
            err.status = 400;
            throw err;
        }

        try {
            const customSearch = await CustomSearchService.postPutUserCustomSearch({id, userId, title, keyword, language, category, topics, undesiredTopics});
            res.status(200).json(customSearch);
        } catch (error) {
            if (typeof(error) === 'string' && error.includes("Error saving this custom search:")) {
                res.status(400).json({error: error});
            } else {
                res.status(500).json({error: error});
            }
        }
    },
    deleteUserCustomSearch: async (req, res) => {
        const {id} = req.body;
        const userId = req.user?.id;
        if (!id) {
            const err = new Error(`An id is required...`);
            err.status = 400;
            throw err;
        }
        if (!userId) {
            const err = new Error(`A user_id is required...`);
            err.status = 400;
            throw err;
        }

        try {
            await CustomSearchService.deleteUserCustomSearch({id, userId});
            res.status(200).json({deleted: true});
        } catch (error) {
            if (typeof(error) === 'string' && error.includes("Error saving this custom search:")) {
                res.status(400).json({error: error});
            } else {
                res.status(500).json({error: error});
            }
        }
    },
}