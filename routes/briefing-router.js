//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: briefing-router.js
//  Description: Router for the daily briefing
//

import express from 'express'
import {BriefingController} from '../controllers/briefing-controller.js';
import {authenticateToken} from "../services/utils/jwt.js";
import {activeProfile} from "../services/utils/active-profile.js";
import {rateLimit} from "../services/utils/rate-limit.js";

const router = express.Router();

router.get('', authenticateToken, activeProfile, BriefingController.latest);
router.post('', authenticateToken, activeProfile, BriefingController.start);
router.post('/:id/vote', authenticateToken, activeProfile, BriefingController.vote);
// a briefing sent by e-mail to the reader, a few times an hour at most: each one goes through the
// account of the server, which Gmail limits
router.post('/:id/email', authenticateToken, rateLimit({windowMs: 3600e3, max: 10, message: 'Too many e-mails sent, try again in an hour.'}),
    BriefingController.email);

export default router;
