//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: profile-router.js
//  Description: Router for the profile of a user
//

import express from 'express'
import {ProfileController} from '../controllers/profile-controller.js';
import {authenticateToken} from "../services/utils/jwt.js";

const router = express.Router();

router.get('', authenticateToken, ProfileController.get);
router.put('', authenticateToken, ProfileController.save);
// the languages a profile can choose from
router.get('/options', ProfileController.options);
router.patch('/interests/:id', authenticateToken, ProfileController.updateInterest);
router.delete('/interests/:id', authenticateToken, ProfileController.deleteInterest);
// the sources of the profile found again
router.post('/discover', authenticateToken, ProfileController.rediscover);
router.post('/kept-sources', authenticateToken, ProfileController.keepSource);
// a source found for the profile removed by the reader, and brought back
router.delete('/sources/:id', authenticateToken, ProfileController.removeSource);
router.post('/removed-sources/restore', authenticateToken, ProfileController.restoreSource);

export default router;
