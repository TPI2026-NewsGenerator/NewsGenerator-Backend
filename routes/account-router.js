//
//  Author: Fabian Rostello
//  Date: 02.10.2026
//  File: account-router.js
//  Description: Router for the settings of an account: its username, its email and its password
//

import express from 'express';
import {AccountController} from "../controllers/account-controller.js";
import {authenticateToken} from "../services/utils/jwt.js";
import {rateLimit} from "../services/utils/rate-limit.js";

const router = express.Router();

// each change asks the password of now: tried one after another, they are stopped as at the login
const accountLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Too many changes tried from here, try again in 15 minutes.',
});

router.put('/username', authenticateToken, accountLimit, AccountController.rename);
router.put('/email', authenticateToken, accountLimit, AccountController.changeEmail);
router.put('/password', authenticateToken, accountLimit, AccountController.changePassword);

export default router;
