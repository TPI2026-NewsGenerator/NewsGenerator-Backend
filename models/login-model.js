"use strict"

import {prisma} from '../config/db.js';

export const LoginModel = {
    getUserByUsername: async (username) => {
        return prisma.users.findFirst({
            where: { username: username }
        })
    }
}
