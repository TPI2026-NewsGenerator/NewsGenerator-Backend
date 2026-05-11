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
    },
    postUserCustomSearch: async (userId, title, keyword, language, category) => {
        return prisma.custom_searches.create({
            data: {
                title: title,
                language: language,
                keyword: keyword,
                timeframe: "Weekly",
                users: {
                    connect: { id: userId }
                },
                custom_searches_has_categories: {
                    create: category.map(catName => ({
                        categories: {
                            connect: { category_name: catName }
                        }
                    }))
                },
            },
        });
    },
    updateUserCustomSearch: async (id, user_id, title, keyword, language, category) => {
        return prisma.custom_searches.update({
            where: { id: id, id_user: user_id },
            data: {
                title: title,
                language: language,
                keyword: keyword,
                custom_searches_has_categories: {
                    deleteMany: {},
                    create: category.map(catName => ({
                        categories: {
                            connect: { category_name: catName }
                        }
                    }))
                },
            },
        });
    },