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

export default router;
