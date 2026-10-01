//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: feed-router.js
//  Description: Router for the feeds added by a user
//

import express from 'express'
import {FeedController} from '../controllers/feed-controller.js';
import {authenticateToken} from "../services/utils/jwt.js";
import {rateLimit} from "../services/utils/rate-limit.js";

const router = express.Router();

// each site checked costs a few requests to the web: a list of a thousand sites per hour at most
const checkLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 40,
    message: "Too many sites checked in the last hour, try again later.",
});

// the feeds are private: the user always comes from the token, never from the request
router.get('', authenticateToken, FeedController.getUserFeeds);
router.post('', authenticateToken, FeedController.addUserFeed);
router.post('/suggestions', authenticateToken, FeedController.suggestSources);
router.post('/search', authenticateToken, FeedController.searchSources);
router.post('/check', authenticateToken, checkLimit, FeedController.checkSites);
router.post('/import', authenticateToken, FeedController.importSources);
router.get('/recommended', authenticateToken, FeedController.getRecommended);
router.post('/recommended', authenticateToken, FeedController.addRecommended);
router.patch('/:id', authenticateToken, FeedController.updateUserFeed);
router.delete('/:id', authenticateToken, FeedController.deleteUserFeed);

export default router;
