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
import {adminOnly} from "../services/utils/admin.js";

const router = express.Router();

router.get('', authenticateToken, activeProfile, BriefingController.latest);
router.post('', authenticateToken, activeProfile, BriefingController.start);
// the tab of what the profile follows, read when it is opened: it can search a month of news
router.get('/following', authenticateToken, activeProfile,
    rateLimit({windowMs: 60e3, max: 20, key: req => `following ${req.user.id}`, message: 'Too many searches of the news you follow, try again in a minute.'}),
    BriefingController.following);
router.post('/:id/vote', authenticateToken, activeProfile, BriefingController.vote);
// the cards that are one affair, then the affair of one card: a month of stories compared and judged by the AI, kept
// for the next requests (see AffairService)
router.get('/:id/affairs', authenticateToken,
    rateLimit({windowMs: 3600e3, max: 60, key: req => `affairs ${req.user.id}`, message: 'Too many affairs asked, try again in an hour.'}),
    BriefingController.affairs);
router.get('/:id/stories/:storyId/affair', authenticateToken,
    rateLimit({windowMs: 3600e3, max: 60, key: req => `affair ${req.user.id}`, message: 'Too many affairs asked, try again in an hour.'}),
    BriefingController.affair);
// the other versions of the cards in the briefings of the other profiles of the account, and a card replaced by one of them (or back):
// the briefings of the reader, read and written without any call of the AI
router.get('/:id/versions', authenticateToken, BriefingController.versions);
router.post('/:id/stories/:storyId/version', authenticateToken,
    rateLimit({windowMs: 3600e3, max: 120, key: req => `version ${req.user.id}`, message: 'Too many versions used, try again in an hour.'}),
    BriefingController.useVersion);
router.delete('/:id/stories/:storyId/version', authenticateToken, BriefingController.restoreVersion);
// the AI version of a card that has none, written when the reader asks (the AI had failed when the briefing was written): a page read and two
// calls of the AI each
router.post('/:id/stories/:storyId/ai-version', authenticateToken,
    rateLimit({windowMs: 3600e3, max: 60, key: req => `ai-version ${req.user.id}`, message: 'Too many AI versions asked, try again in an hour.'}),
    BriefingController.writeAiVersion);
// the e-mail of the briefing is for the administrators only (see admin.js)
const MAIL_REFUSED = 'Sending the briefing by e-mail is for the administrators.';
router.get('/:id/stories/:storyId/pictures', authenticateToken, adminOnly(MAIL_REFUSED), BriefingController.pictures);
// a neutral title the AI proposes for a card, asked for in the editor of the e-mail: a call of the AI each
router.post('/:id/stories/:storyId/neutral-title', authenticateToken, adminOnly(MAIL_REFUSED),
    rateLimit({windowMs: 3600e3, max: 120, key: req => `neutral-title ${req.user.id}`, message: 'Too many neutral titles asked, try again in an hour.'}),
    BriefingController.neutralTitle);
// a news added to the briefing by its link, for the e-mail: a page read and a call of the AI each
router.post('/:id/news', authenticateToken, adminOnly(MAIL_REFUSED),
    rateLimit({windowMs: 3600e3, max: 30, key: req => `news ${req.user.id}`, message: 'Too many news added, try again in an hour.'}),
    BriefingController.importNews);
// the news of the briefings of the other profiles of the account, listed and copied into this briefing from the editor of the e-mail: the
// briefings of the reader, read and written without any call of the AI
router.get('/:id/profiles-news', authenticateToken, adminOnly(MAIL_REFUSED), BriefingController.profilesNews);
router.post('/:id/news/copy', authenticateToken, adminOnly(MAIL_REFUSED),
    rateLimit({windowMs: 3600e3, max: 120, key: req => `news copy ${req.user.id}`, message: 'Too many news copied, try again in an hour.'}),
    BriefingController.copyNews);
// two cards of the same news made one, the reader choosing which one is kept (the other is folded into it)
router.post('/:id/news/fold', authenticateToken, adminOnly(MAIL_REFUSED),
    rateLimit({windowMs: 3600e3, max: 120, key: req => `news fold ${req.user.id}`, message: 'Too many cards folded, try again in an hour.'}),
    BriefingController.foldNews);
router.delete('/:id/news/:storyId', authenticateToken, adminOnly(MAIL_REFUSED), BriefingController.removeNews);
// cards of a briefing sent by e-mail, a few times an hour and a day at most: each one goes through the
// account of the server, which Gmail limits (500 a day), to any address the reader writes
router.post('/:id/email', authenticateToken, adminOnly(MAIL_REFUSED),
    rateLimit({windowMs: 3600e3, max: 10, message: 'Too many e-mails sent, try again in an hour.'}),
    rateLimit({windowMs: 24 * 3600e3, max: 30, key: req => `user ${req.user.id}`, message: 'Too many e-mails sent today, try again tomorrow.'}),
    BriefingController.email);
// the e-mail shown while the reader changes it (nothing is sent): asked at each change, so a limit of its own
router.post('/:id/email/preview', authenticateToken, adminOnly(MAIL_REFUSED),
    rateLimit({windowMs: 600e3, max: 200, key: req => `email preview ${req.user.id}`, message: 'Too many previews of the e-mail, try again in a few minutes.'}),
    BriefingController.emailPreview);

export default router;
