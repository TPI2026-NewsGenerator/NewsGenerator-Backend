"use strict"

import {prisma} from '../config/db.js';

export const CustomSearchModel = {
    getUserCustomSearch: async (user_id) => {
        return prisma.users.findFirst({
            where: {
                id: user_id
            },
            include: {
                keywords: true,

                user_selected_categories: {
                    include: {
                        categories: true
                    }
                }
            }
        })
    }
}