//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: login-model.js
//  Description: Model for login feature
//

"use strict"

import {prisma} from '../config/db.js';

export const LoginModel = {
    // the account of this username whatever its case, as it is unique whatever its case (see
    // UserModel.taken) and Settings lets a reader change only its case: "Fabian" signs in as "fabian".
    // An account of the exact name first, should two older ones differ only by their case
    getUserByUsername: async (username) => {
        const users = await prisma.users.findMany({
            where: {username: {equals: username, mode: 'insensitive'}},
        });
        return users.find(user => user.username === username) ?? users[0] ?? null;
    }
}
