//
//  Author: Fabian Rostello
//  Date: 04.11.2026
//  File: affair-router.js
//  Description: Router for the affairs a reader follows and the devices told when one moves
//

import express from 'express'
import {AffairController} from '../controllers/affair-controller.js';
import {authenticateToken} from "../services/utils/jwt.js";
import {rateLimit} from "../services/utils/rate-limit.js";

const router = express.Router();

router.get('', authenticateToken, AffairController.list);
router.get('/unread', authenticateToken, AffairController.unread);
// following builds the affair when its page was not opened first: a month of stories and a few calls of the AI
router.post('', authenticateToken,
    rateLimit({windowMs: 3600e3, max: 40, key: req => `follow ${req.user.id}`, message: 'Too many affairs followed, try again in an hour.'}),
    AffairController.follow);

// the devices: their keys are the ones of the browser, nothing else is kept
router.get('/push/key', authenticateToken, AffairController.pushKey);
router.post('/push/subscription', authenticateToken,
    rateLimit({windowMs: 3600e3, max: 30, key: req => `push ${req.user.id}`, message: 'Too many devices added, try again in an hour.'}),
    AffairController.subscribe);
router.delete('/push/subscription', authenticateToken, AffairController.unsubscribe);

router.get('/:id', authenticateToken, AffairController.detail);
router.post('/:id/seen', authenticateToken, AffairController.seen);
router.delete('/:id', authenticateToken, AffairController.unfollow);

export default router;
