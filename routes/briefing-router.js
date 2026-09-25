//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: briefing-router.js
//  Description: Router for the daily briefing
//

import express from 'express'
import {BriefingController} from '../controllers/briefing-controller.js';
import {authenticateToken} from "../services/utils/jwt.js";

const router = express.Router();

router.get('', authenticateToken, BriefingController.latest);
router.post('', authenticateToken, BriefingController.start);
router.post('/:id/seen', authenticateToken, BriefingController.seen);
router.post('/:id/vote', authenticateToken, BriefingController.vote);

export default router;
