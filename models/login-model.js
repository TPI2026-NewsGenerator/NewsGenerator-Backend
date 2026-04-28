"use strict"

import {prisma} from '../config/db.js';

export const LoginModel = {
    authUser: async (username, password) => {
        const user = await prisma.users.findFirst({
            where: { username: username, password: password }
        })
        return user;
    }
}
