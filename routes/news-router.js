//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: news-router.js
//  Description: Router for news feature
//

import express from 'express'
import {NewsController} from '../controllers/news-controller.js';
import {authenticateToken} from "../services/utils/jwt.js";
import {activeProfile} from "../services/utils/active-profile.js";

const router = express.Router();

router.post('', authenticateToken, activeProfile, NewsController.getNews);
// categories of feeds that can be searched
router.get('/categories', NewsController.getCategories);
// AI resume of the news selected by the user (10 max)
router.post('/summary', authenticateToken, activeProfile, NewsController.getNewsSummary);
// titles and descriptions of the news found, translated into the language of the search
router.post('/translations', authenticateToken, activeProfile, NewsController.translateNews);

export default router;