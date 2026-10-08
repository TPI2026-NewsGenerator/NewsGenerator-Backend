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

// Each site checked costs a few requests to the web. Counted in sites, per account: 40 requests per
// address cut a list of 865 sources, sent with the address of each site and of its feed (1469), and a
// second try in the hour stopped at the first parts. Per address too, at twice as many: the accounts of
// one home, never a crowd of accounts
const SITES_CHECKED_PER_HOUR = 2000;
const sitesOf = (req) => Array.isArray(req.body?.sites) ? req.body.sites.length : 1;
const checkLimits = [
    rateLimit({windowMs: 60 * 60 * 1000, max: SITES_CHECKED_PER_HOUR, cost: sitesOf, key: (req) => req.user.id,
        message: `You checked ${SITES_CHECKED_PER_HOUR} sites in the last hour, the most the server checks for you.`}),
    rateLimit({windowMs: 60 * 60 * 1000, max: 2 * SITES_CHECKED_PER_HOUR, cost: sitesOf,
        message: `Too many sites checked from your address in the last hour.`}),
];

// the feeds are private: the user always comes from the token, never from the request
router.get('', authenticateToken, activeProfile, FeedController.getUserFeeds);
router.post('', authenticateToken, activeProfile, needsProfile, FeedController.addUserFeed);
router.post('/suggestions', authenticateToken, activeProfile, FeedController.suggestSources);
router.post('/search', authenticateToken, activeProfile, FeedController.searchSources);
router.post('/check', authenticateToken, activeProfile, ...checkLimits, FeedController.checkSites);
router.post('/import', authenticateToken, activeProfile, needsProfile, FeedController.importSources);
router.get('/recommended', authenticateToken, activeProfile, FeedController.getRecommended);
router.post('/recommended', authenticateToken, activeProfile, needsProfile, FeedController.addRecommended);
router.patch('/:id', authenticateToken, activeProfile, FeedController.updateUserFeed);
router.delete('/:id', authenticateToken, activeProfile, FeedController.deleteUserFeed);

export default router;
