//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: router.js
//  Description: Entry point of different routers
//

import express from 'express';
import loginRouter from './login-router.js';
import signupRouter from './signup-router.js';
import newsRouter from './news-router.js';
import feedRouter from './feed-router.js';
import customSearchRouter from './customsearch-router.js';
import profileRouter from './profile-router.js';
import briefingRouter from './briefing-router.js';
import cors from "cors";

const router = express.Router();
router.use(express.json());
router.use(cors());

router.use('/login', loginRouter);
router.use('/signup', signupRouter);
router.use('/news', newsRouter);
router.use('/feeds', feedRouter);
router.use('/customsearch', customSearchRouter);
router.use('/profile', profileRouter);
router.use('/briefing', briefingRouter);

export default router;