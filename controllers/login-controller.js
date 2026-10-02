//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: login-controller.js
//  Description: Controller for login feature
//

"use strict"

import {LoginService} from "../services/login-service.js";
import {startSession} from "../services/utils/jwt.js";


export const LoginController = {
    authUser: async (req, res) => {
        const {username, password} = req.body

        // username verification
        if (!username || typeof username !== "string" || username === ""){
            return res.status(400).json({error: "Username is required."});
        }

        // password verification
        if (!password || typeof password !== "string" || password === ""){
            return res.status(400).json({error: "Password is required."});
        }

        try {
            // the token goes in a cookie the page cannot read, never in the answer
            const {token, ...user} = await LoginService.authUser(req.body);
            startSession(res, token);

            return res.status(200).json(user);
        } catch (error) {
            const statusCode = error.status || 500;
            return res.status(statusCode).json({ error: error.message });
        }
    }
}

