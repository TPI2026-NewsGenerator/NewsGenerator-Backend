//
//  Author: Fabian Rostello
//  Date: 02.10.2026
//  File: account-router.js
//  Description: Router for the settings of an account: its username, its email and its password, and its display preferences
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

// the display preferences ask no password and are saved as the reader sets them (the page waits a moment between two saves):
// counted by account, apart from the changes above
router.get('/preferences', authenticateToken,
    rateLimit({windowMs: 10 * 60e3, max: 60, key: req => `preferences read ${req.user.id}`, message: 'Too many preferences read, try again in a few minutes.'}),
    AccountController.preferences);
router.put('/preferences', authenticateToken,
    rateLimit({windowMs: 10 * 60e3, max: 200, key: req => `preferences save ${req.user.id}`, message: 'Too many preferences saved, try again in a few minutes.'}),
    AccountController.savePreferences);

export default router;
