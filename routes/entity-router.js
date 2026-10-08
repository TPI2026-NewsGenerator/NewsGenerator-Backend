//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: entity-router.js
//  Description: Router for the clubs, people and organisations a profile follows
//

import express from 'express'
import {EntityController} from '../controllers/entity-controller.js';
import {authenticateToken} from "../services/utils/jwt.js";
import {activeProfile, needsProfile} from "../services/utils/active-profile.js";
import {rateLimit} from "../services/utils/rate-limit.js";

const router = express.Router();

// each search and each item read asks Wikidata: a few a minute per reader
const wikidataLimit = rateLimit({windowMs: 60e3, max: 30, key: req => `user ${req.user.id}`,
    message: 'Too many searches of Wikidata, try again in a minute.'});

router.get('', authenticateToken, activeProfile, EntityController.list);
router.get('/search', authenticateToken, wikidataLimit, activeProfile, EntityController.search);
router.post('', authenticateToken, wikidataLimit, activeProfile, needsProfile, EntityController.follow);
router.get('/:qid', authenticateToken, wikidataLimit, activeProfile, needsProfile, EntityController.page);
router.put('/:qid/names', authenticateToken, activeProfile, needsProfile, EntityController.setNames);
router.delete('/:qid', authenticateToken, activeProfile, needsProfile, EntityController.unfollow);

export default router;
