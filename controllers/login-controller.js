"use strict"

import {LoginService} from "../services/login-service.js";


export const LoginController = {
    authUser: async (req, res) => {
        const {username, password} = req.body

        // username verification
        if (typeof username !== "string" || !username || username === ""){
            const err = new Error(`Username can not be empty and must be text.`);
            err.status = 400;
            throw err;
        }

        // password verification
        if (typeof password !== "string" || !password || password === ""){
            const err = new Error(`Username can not be empty and must be text.`);
            err.status = 400;
            throw err;
        }

        try {
            const users = await LoginService.authUser(req.body);
            res.status(200).json(users);
        } catch (error) {
            res.status(500).json({error: error});
        }
    }
}

