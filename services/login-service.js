"use strict"

import {LoginModel} from '../models/login-model.js'

export const LoginService = {
    authUser: async ({username, password}) => {
        return await LoginModel.authUser(username, password)
    },
}