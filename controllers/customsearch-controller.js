//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: customsearch-controller.js
//  Description: Controller for custom searches feature
//

"use strict"

import {CustomSearchService} from '../services/customsearch-service.js';

export const CustomSearchController = {
    getUserCustomSearch: async (req, res) => {
        const {userId} = req.query;

        if (!userId) {
            const err = new Error(`An id is required...`);
            err.status = 400;
            throw err;
        }

        try {
            const customSearch = await CustomSearchService.getUserCustomSearch(req.query);
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
        const {userId, title, keyword, language, category} = req.body;
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

        try {
            const customSearch = await CustomSearchService.postPutUserCustomSearch(req.body);
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
        const {id, userId} = req.body;
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
            const customSearch = await CustomSearchService.deleteUserCustomSearch(req.body);
            res.status(200).json(customSearch);
        } catch (error) {
            if (typeof(error) === 'string' && error.includes("Error saving this custom search:")) {
                res.status(400).json({error: error});
            } else {
                res.status(500).json({error: error});
            }
        }
    },
}