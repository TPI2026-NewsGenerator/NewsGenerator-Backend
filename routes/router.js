//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: router.js
//  Description: Entry point of different routers
//

import express from 'express';
import loginRouter from './login-router.js';
import newsRouter from './news-router.js';
import feedRouter from './feed-router.js';
import customSearchRouter from './customsearch-router.js';
import cors from "cors";

const router = express.Router();
router.use(express.json());
router.use(cors());

router.use('/login', loginRouter);
router.use('/news', newsRouter);
router.use('/feeds', feedRouter);
router.use('/customsearch', customSearchRouter);

export default router;