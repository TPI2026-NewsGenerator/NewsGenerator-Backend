//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: feed-router.js
//  Description: Router for the feeds added by a user
//

import express from 'express'
import {FeedController} from '../controllers/feed-controller.js';
import {authenticateToken} from "../services/utils/jwt.js";

const router = express.Router();

// the feeds are private: the user always comes from the token, never from the request
router.get('', authenticateToken, FeedController.getUserFeeds);
router.post('', authenticateToken, FeedController.addUserFeed);
router.delete('/:id', authenticateToken, FeedController.deleteUserFeed);

export default router;
