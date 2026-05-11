"use strict"

import { CustomSearchModel } from '../models/customsearch-model.js'

export const CustomSearchService = {
    getUserCustomSearch: async ({id}) => {
        if (!id) {
            const err = new Error(`A id is required...`);
            err.status = 400;
            throw err;
        }

        const response = await CustomSearchModel.getUserCustomSearch(parseInt(id))

        if (!response) {
            const err = new Error(`This user_id does not exist...`);
            err.status = 404;
            throw err;
        }

        return {id_user: user.id};
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
    }
}