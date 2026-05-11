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
    postUserCustomSearch: async ({id, userId, title, keyword, language, category}) => {
        if (!userId) {
            const err = new Error(`A user id is required...`);
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

        if (id) {
            return await CustomSearchModel.updateUserCustomSearch(parseInt(id), parseInt(userId), title, keyword, language, category)
        } else {
            return await CustomSearchModel.postUserCustomSearch(parseInt(userId), title, keyword, language, category)
        }
    },
    deleteUserCustomSearch: async ({id, userId}) => {
        if (!id) {
            const err = new Error(`An id is required...`);
            err.status = 404;
            throw err;
        }
        if (!userId) {
            const err = new Error(`A user_id is required...`);
            err.status = 404;
            throw err;
        }

        return await CustomSearchModel.deleteUserCustomSearch(parseInt(id), parseInt(userId))
    }
}