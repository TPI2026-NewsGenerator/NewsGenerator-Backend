//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: fifa-router.js
//  Description: Router for the map "The FIFA presidency", under /api/fifa. The session of a reader (cookie), not the key of /api/v1. Every signed-in reader
//               sees it, adds a candidate and votes; only an administrator takes a candidate off the map or a vote off
//

import express from 'express'
import {FifaController} from '../controllers/fifa-controller.js';
import {authenticateToken} from "../services/utils/jwt.js";
import {adminOnly} from "../services/utils/admin.js";
import {rateLimit} from "../services/utils/rate-limit.js";

const router = express.Router();

router.get('/map', authenticateToken, FifaController.map);
router.get('/subjects', authenticateToken, FifaController.subjects);
router.get('/presidents', authenticateToken, FifaController.presidents);
router.get('/confederations', authenticateToken, FifaController.confederations);
router.get('/associations/:qid', authenticateToken, FifaController.association);

// the persons of Wikidata the reader picks a candidate from: one call of Wikidata, a few a minute
router.get('/people', authenticateToken,
    rateLimit({windowMs: 60e3, max: 30, key: req => `fifa people ${req.user.id}`, message: 'Too many searches, try again in a minute.'}),
    FifaController.people);

// adding a candidate reads 30 days of news with the AI (a few hundred thousand tokens): a few a day for each reader, and six on the map at most
router.post('/subjects', authenticateToken,
    rateLimit({windowMs: 24 * 3600e3, max: 3, key: req => `fifa subject ${req.user.id}`, message: 'Too many candidates added today, try again tomorrow.'}),
    FifaController.addSubject);
router.patch('/subjects/:qid', authenticateToken,
    rateLimit({windowMs: 3600e3, max: 20, key: req => `fifa status ${req.user.id}`, message: 'Too many changes, try again in an hour.'}),
    FifaController.setStatus);
router.delete('/subjects/:qid', authenticateToken, adminOnly('Only an administrator takes a candidate off the map.'), FifaController.removeSubject);

// the vote of a reader decides for everyone: a limit so that one reader cannot flood the map
router.post('/votes', authenticateToken,
    rateLimit({windowMs: 10 * 60e3, max: 30, key: req => `fifa vote ${req.user.id}`, message: 'Too many votes in a short time, try again in a few minutes.'}),
    FifaController.vote);
// the weekly audit of the positions shown: how far a third model and the readers agree with them (see fifa-audit.js)
router.get('/audits', authenticateToken, adminOnly('Only an administrator reads the audits.'), FifaController.audits);
router.delete('/votes/:id', authenticateToken, adminOnly('Only an administrator takes a vote off.'), FifaController.removeVote);

export default router;
