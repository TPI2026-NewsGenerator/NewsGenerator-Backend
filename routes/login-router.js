//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: login-router.js
//  Description: Router for login feature
//

import express from 'express'
import {LoginController} from "../controllers/login-controller.js";
import {rateLimit} from "../services/utils/rate-limit.js";

const router = express.Router();

// served on the internet: passwords tried one after another from one address are stopped
const loginLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Too many sign-in attempts from here, try again in 15 minutes.',
});

// the fields are checked by the controller
router.post('', loginLimit, LoginController.authUser);

export default router;