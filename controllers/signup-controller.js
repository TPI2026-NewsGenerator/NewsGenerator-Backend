//
//  Author: Fabian Rostello
//  Date: 29.09.2026
//  File: signup-controller.js
//  Description: Controller for the accounts created by the readers
//

"use strict"

import {SignupService} from "../services/signup-service.js";

export const SignupController = {
    register: async (req, res) => {
        const {username, email, password, text, topics, languages} = req.body ?? {};

        try {
            return res.status(201).json(await SignupService.register({username, email, password, text, topics, languages}));
        } catch (error) {
            // anyone can call this route: what failed inside (the embedder, its address) stays here
            const status = error.status || 500;
            if (status >= 500) {
                console.error(`Signup: ${error.message ?? error}`);
                return res.status(status).json({error: 'Your account could not be created right now, try again in a few minutes.'});
            }
            return res.status(status).json({error: error.message ?? String(error)});
        }
    },
};
