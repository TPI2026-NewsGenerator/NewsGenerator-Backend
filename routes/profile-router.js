//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: profile-router.js
//  Description: Router for the profile of a user
//

import express from 'express'
import {ProfileController} from '../controllers/profile-controller.js';
import {authenticateToken} from "../services/utils/jwt.js";
import {activeProfile} from "../services/utils/active-profile.js";
import {rateLimit} from "../services/utils/rate-limit.js";
import {signupOpen} from "../services/utils/account-rules.js";

const router = express.Router();
// a profile written with the AI costs a call of the AI each round, and comes before the account: counted
// by address, 10 profiles an hour (3 rounds of questions and the text each)
const funnelLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 40,
    message: 'Too many questions asked from here, try again in an hour.',
});
// before the account only while accounts can be made: the AI is never asked for someone who cannot make one
const funnelAccess = (req, res, next) => signupOpen() ? next() : authenticateToken(req, res, next);

router.get('', authenticateToken, activeProfile, ProfileController.get);
router.put('', authenticateToken, activeProfile, ProfileController.save);
// the languages a profile can choose from
router.get('/options', ProfileController.options);
// the questions of the AI, then the profile it writes from the answers: nothing saved
router.post('/funnel/questions', funnelAccess, funnelLimit, ProfileController.funnelQuestions);
router.post('/funnel/text', funnelAccess, funnelLimit, ProfileController.funnelText);
router.patch('/interests/:id', authenticateToken, activeProfile, ProfileController.updateInterest);
router.delete('/interests/:id', authenticateToken, activeProfile, ProfileController.deleteInterest);
// the sources of the profile found again
router.post('/discover', authenticateToken, activeProfile, ProfileController.rediscover);
router.post('/kept-sources', authenticateToken, activeProfile, ProfileController.keepSource);
// a source found for the profile removed by the reader, and brought back
router.delete('/sources/:id', authenticateToken, activeProfile, ProfileController.removeSource);
router.post('/removed-sources/restore', authenticateToken, activeProfile, ProfileController.restoreSource);
// the names or words whose news are always shown
router.put('/watch-terms', authenticateToken, activeProfile, ProfileController.setWatchTerms);
// the other profiles of the reader: written, renamed, deleted
router.get('/profiles', authenticateToken, ProfileController.list);
router.post('/profiles', authenticateToken, ProfileController.create);
router.patch('/profiles/:id', authenticateToken, ProfileController.rename);
router.delete('/profiles/:id', authenticateToken, ProfileController.remove);

export default router;
