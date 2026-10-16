//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: login-service.js
//  Description: Service for login feature
//

"use strict"

import {verifyPassword} from './utils/pwd-hasher.js'
import {generateAccessToken} from "./utils/jwt.js";
import {LoginModel} from '../models/login-model.js'

// a bcrypt hash of the same cost as the real ones (12) that no password matches: an unknown username
// is checked against it, so it takes as long as a wrong password and the answer can't be timed
const NO_ACCOUNT = '$2b$12$OUzQNCSgw1BMqAtlGQPSzeSaAImKNFX67XWLeLYZaKD1bAtPpfXum';

export const LoginService = {
    authUser: async ({username, password}) => {
        // get user
        const user = await LoginModel.getUserByUsername(username)

        // compare password; an unknown username and a wrong password answer the same, so the login
        // never tells which usernames exist
        const correctPassword = await verifyPassword(password, user?.password ?? NO_ACCOUNT);
        if (!user || !correctPassword) {
            const err = new Error(`Invalid username or password...`);
            err.status = 401;
            throw err;
        }

        // create jwt
        const token = generateAccessToken({id: user.id, username: user.username, email: user.email, role: user.role})

        return {id_user: user.id, token: token};
    },
}