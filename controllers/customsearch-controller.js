"use strict"

import {CustomSearchService} from '../services/customsearch-service.js';

export const CustomSearchController = {
    getUserCustomSearch: async (req, res) => {
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
        try {
            const customSearch = await CustomSearchService.postUserCustomSearch(req.body);
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