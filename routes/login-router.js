//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: login-router.js
//  Description: Router for login feature
//

import express from 'express'
import { body } from 'express-validator';
import {LoginController} from "../controllers/login-controller.js";

const router = express.Router();

const fetchLoginValidator = [
    body('username').isString().withMessage('username must be a string'),
    body('password').isString().withMessage('password must be a string'),
];

router.post('', fetchLoginValidator, LoginController.authUser);

export default router;