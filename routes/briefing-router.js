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

const router = express.Router();

router.get('', authenticateToken, activeProfile, BriefingController.latest);
router.post('', authenticateToken, activeProfile, BriefingController.start);
router.post('/:id/vote', authenticateToken, activeProfile, BriefingController.vote);

export default router;
