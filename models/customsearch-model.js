"use strict"

import {prisma} from '../config/db.js';

export const CustomSearchModel = {
    getUserCustomSearch: async (id) => {
        return prisma.users.findFirst({
            where: {
                id: id
            },
            include: {
                custom_searches: {
                    include: {
                        custom_searches_has_categories: {
                            include: {
                                categories: true,
                            },
                        },
                    },
                },
            },
        })
    }
}