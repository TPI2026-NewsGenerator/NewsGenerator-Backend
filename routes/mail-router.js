//
//  Author: Fabian Rostello
//  Date: 10.10.2026
//  File: mail-router.js
//  Description: Router for the e-mails of a briefing as they were sent, read by their link
//

import express from 'express'
import {BriefingController} from '../controllers/briefing-controller.js';
import {rateLimit} from "../services/utils/rate-limit.js";

const router = express.Router();

// no account: whoever got the e-mail, forwarded or not, reads it as it was sent. Its token cannot be
// guessed; the limit only keeps anyone from trying
router.get('/:token', rateLimit({windowMs: 15 * 60e3, max: 60, message: 'Too many e-mails read, try again later.'}), BriefingController.original);

export default router;
