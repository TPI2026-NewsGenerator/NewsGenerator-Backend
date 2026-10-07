//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: feed-router.js
//  Description: Router for the feeds added by a user
//

import express from 'express'
import {FeedController} from '../controllers/feed-controller.js';
import {authenticateToken} from "../services/utils/jwt.js";
import {activeProfile, needsProfile} from "../services/utils/active-profile.js";
import {rateLimit} from "../services/utils/rate-limit.js";

const router = express.Router();

// each site checked costs a few requests to the web: a list of a thousand sites per hour at most
const checkLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 40,
    message: "Too many sites checked in the last hour, try again later.",
});

// the feeds are private: the user always comes from the token, never from the request
router.get('', authenticateToken, activeProfile, FeedController.getUserFeeds);
router.post('', authenticateToken, activeProfile, needsProfile, FeedController.addUserFeed);
router.post('/suggestions', authenticateToken, activeProfile, FeedController.suggestSources);
router.post('/search', authenticateToken, activeProfile, FeedController.searchSources);
router.post('/check', authenticateToken, activeProfile, checkLimit, FeedController.checkSites);
router.post('/import', authenticateToken, activeProfile, needsProfile, FeedController.importSources);
router.get('/recommended', authenticateToken, activeProfile, FeedController.getRecommended);
router.post('/recommended', authenticateToken, activeProfile, needsProfile, FeedController.addRecommended);
router.patch('/:id', authenticateToken, activeProfile, FeedController.updateUserFeed);
router.delete('/:id', authenticateToken, activeProfile, FeedController.deleteUserFeed);

export default router;
