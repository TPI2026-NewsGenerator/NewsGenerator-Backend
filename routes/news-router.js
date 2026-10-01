//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: news-router.js
//  Description: Router for news feature
//

import express from 'express'
import { body } from 'express-validator';
import {NewsController} from '../controllers/news-controller.js';
import {authenticateToken} from "../services/utils/jwt.js";

const router = express.Router();

const fetchNewsValidator = [
    body('category').isArray().withMessage('categories must be an array'),
    body('keywords').isArray().withMessage('keywords must be an array'),
    body('language').isString().withMessage('language must be a string'),
    body('timeframe').isObject().withMessage('timeframe must be an object with properties "start" and "end"'),
];

router.post('', authenticateToken, fetchNewsValidator, NewsController.getNews);
// categories of feeds that can be searched
router.get('/categories', NewsController.getCategories);
// full content of the news selected by the user (10 max)
router.post('/content', authenticateToken, NewsController.getNewsContent);
// AI resume of the news selected by the user (10 max)
router.post('/summary', authenticateToken, NewsController.getNewsSummary);
// titles and descriptions of the news found, translated into the language of the search
router.post('/translations', authenticateToken, NewsController.translateNews);

export default router;