"use strict"

import { CustomSearchModel } from '../models/customsearch-model.js'

export const CustomSearchService = {
    getUserCustomSearch: async ({userId}) => {
        const response = await CustomSearchModel.getUserCustomSearch(parseInt(userId))

        if (!response) {
            const err = new Error(`This user_id does not exist...`);
            err.status = 404;
            throw err;
        }

        return response.custom_searches.map(search => {
            return {
                id: search.id,
                title: search.title,
                keyword: search.keyword,
                language: search.language,
                timeframe: search.timeframe,
                category: search.custom_searches_has_categories.map(selected => selected.categories.category_name.toLowerCase())
            }
        })
    },
    postPutUserCustomSearch: async ({id, userId, title, keyword, language, category}) => {
        if (id) {
            return await CustomSearchModel.updateUserCustomSearch(parseInt(id), parseInt(userId), title, keyword, language, category)
        } else {
            return await CustomSearchModel.postUserCustomSearch(parseInt(userId), title, keyword, language, category)
        }
    },
    deleteUserCustomSearch: async ({id, userId}) => {
        const response = await CustomSearchModel.deleteUserCustomSearch(parseInt(id), parseInt(userId))

        if (!response) {
            const err = new Error(`No link between the member and the custom search exists...`);
            err.status = 404;
            throw err;
        }
    }
}