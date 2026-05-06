"use strict"

import {verifyPassword} from './utils/pwd-hasher.js'
import {generateAccessToken} from "./utils/jwt.js";
import {LoginModel} from '../models/login-model.js'


export const LoginService = {
    authUser: async ({username, password}) => {
        // get user
        const user = await LoginModel.getUserByUsername(username)

        if (!user) {
            const err = new Error(`This username does not exist...`);
            err.status = 404;
            throw err;
        }

        // compare password
        const correctPassword = await verifyPassword(password, user.password);
        if (!correctPassword) {
            const err = new Error(`Invalid password...`);
            err.status = 401;
            throw err;
        }

        // create jwt
        const token = generateAccessToken({id: user.id, username: user.username, email: user.email, role: user.role})

        return {id_user: user.id, token: token};
    },
}