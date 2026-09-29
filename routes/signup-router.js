//
//  Author: Fabian Rostello
//  Date: 29.09.2026
//  File: signup-router.js
//  Description: Router for the accounts created by the readers
//

import express from 'express'
import {SignupController} from "../controllers/signup-controller.js";
import {rateLimit} from "../services/utils/rate-limit.js";

const router = express.Router();

// an account costs a reading by the AI and a search of sources on the web: a few per address and hour
const signupLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: 'Too many accounts created from here, try again in an hour.',
});

router.post('', signupLimit, SignupController.register);

export default router;
