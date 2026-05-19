//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: login-model.js
//  Description: Model for login feature
//

"use strict"

import {prisma} from '../config/db.js';

export const LoginModel = {
    getUserByUsername: async (username) => {
        return prisma.users.findFirst({
            where: { username: username }
        })
    }
}
