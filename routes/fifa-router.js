//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: fifa-router.js
//  Description: Router for the map "The FIFA presidency", under /api/fifa. The session of a reader (cookie), not the key of /api/v1. Every signed-in reader
//               sees it, adds a candidate, takes one off and votes; only an administrator takes the president in office off the map or a vote off
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
// the news that name the president of the association (a query of the shared tables: a few a minute)
router.get('/associations/:qid/leader/news', authenticateToken,
    rateLimit({windowMs: 60e3, max: 30, key: req => `fifa leader news ${req.user.id}`, message: 'Too many requests, try again in a minute.'}),
    FifaController.leaderNews);

// the persons of Wikidata the reader picks a candidate from: one call of Wikidata, a few a minute
router.get('/people', authenticateToken,
    rateLimit({windowMs: 60e3, max: 30, key: req => `fifa people ${req.user.id}`, message: 'Too many searches, try again in a minute.'}),
    FifaController.people);

// adding a candidate reads 30 days of news with the AI (about 4 600 tokens a passage: 3 million tokens, about 1.5 dollars, for the person in office, who has 680
// passages; 0.5 million and 0.3 dollar for a candidate with 130): a few a day for each reader, six on the map at most, 800 passages at most for each (FIFA_MAX_PASSAGES)
router.post('/subjects', authenticateToken,
    rateLimit({windowMs: 24 * 3600e3, max: 3, key: req => `fifa subject ${req.user.id}`, message: 'Too many candidates added today, try again tomorrow.'}),
    FifaController.addSubject);
router.patch('/subjects/:qid', authenticateToken,
    rateLimit({windowMs: 3600e3, max: 20, key: req => `fifa status ${req.user.id}`, message: 'Too many changes, try again in an hour.'}),
    FifaController.setStatus);
// any reader takes a candidate off the map (the system can be wrong), a few an hour: what was read for him goes with him, so it is not a click to repeat. The president in office stays
// (an administrator only, decided in the service)
router.delete('/subjects/:qid', authenticateToken,
    rateLimit({windowMs: 3600e3, max: 10, key: req => `fifa remove subject ${req.user.id}`, message: 'Too many candidates taken off, try again in an hour.'}),
    FifaController.removeSubject);

// the vote of a reader decides for everyone: a limit so that one reader cannot flood the map
router.post('/votes', authenticateToken,
    rateLimit({windowMs: 10 * 60e3, max: 30, key: req => `fifa vote ${req.user.id}`, message: 'Too many votes in a short time, try again in a few minutes.'}),
    FifaController.vote);
// the reader chooses, for an association, the candidate it leans toward (written as votes: one choice is a few of them): the same budget as a vote
router.post('/leans', authenticateToken,
    rateLimit({windowMs: 10 * 60e3, max: 30, key: req => `fifa lean ${req.user.id}`, message: 'Too many votes in a short time, try again in a few minutes.'}),
    FifaController.lean);
// a note on an association, visible to every reader: a few an hour for each (the author or an administrator takes it off)
router.post('/notes', authenticateToken,
    rateLimit({windowMs: 3600e3, max: 10, key: req => `fifa note ${req.user.id}`, message: 'Too many notes, try again in an hour.'}),
    FifaController.addNote);
router.delete('/notes/:id', authenticateToken, FifaController.removeNote);
// a source added on its own, with no candidate (the AI reads the page): the same budget as a vote (the author or an administrator takes it off)
router.post('/sources', authenticateToken,
    rateLimit({windowMs: 10 * 60e3, max: 10, key: req => `fifa source ${req.user.id}`, message: 'Too many sources in a short time, try again in a few minutes.'}),
    FifaController.addSource);
router.delete('/sources/:id', authenticateToken, FifaController.removeSource);
// the weekly audit of the positions shown: how far a third model and the readers agree with them (see fifa-audit.js)
router.get('/audits', authenticateToken, adminOnly('Only an administrator reads the audits.'), FifaController.audits);
router.delete('/votes/:id', authenticateToken, adminOnly('Only an administrator takes a vote off.'), FifaController.removeVote);

export default router;
