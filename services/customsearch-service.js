"use strict"

import { CustomSearchModel } from '../models/customsearch-model.js'

export const CustomSearchService = {
    getUserCustomSearch: async ({user_id}) => {
        // get user
        const user = await CustomSearchModel.getUserCustomSearch(user_id)

        if (!user) {
            const err = new Error(`This user_id does not exist...`);
            err.status = 404;
            throw err;
        }

        return {id_user: user.id};
    }
}