//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: login-controller.js
//  Description: Controller for login feature
//

"use strict"

import {LoginService} from "../services/login-service.js";


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
            const user = await LoginService.authUser(req.body);

            return res.status(200).json(user);
        } catch (error) {
            const statusCode = error.status || 500;
            return res.status(statusCode).json({ error: error.message });
        }
    }
}

