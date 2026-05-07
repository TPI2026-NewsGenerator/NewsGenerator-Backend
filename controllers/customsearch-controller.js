"use strict"

import {CustomSearchService} from '../services/customsearch-service.js';

export const CustomSearchController = {
    getUserCustomSearch: async (req, res) => {
        try {
            const news = await CustomSearchService.getUserCustomSearch(req.body);
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