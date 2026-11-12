//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: router.js
//  Description: Entry point of different routers
//

import express from 'express';
import loginRouter from './login-router.js';
import signupRouter from './signup-router.js';
import sessionRouter from './session-router.js';
import accountRouter from './account-router.js';
import newsRouter from './news-router.js';
import feedRouter from './feed-router.js';
import customSearchRouter from './customsearch-router.js';
import profileRouter from './profile-router.js';
import briefingRouter from './briefing-router.js';
import affairRouter from './affair-router.js';
import fifaRouter from './fifa-router.js';
import entityRouter from './entity-router.js';
import mailRouter from './mail-router.js';
import v1Router from './v1-router.js';
import cors from "cors";

const router = express.Router();
router.use(express.json());
router.use(cors());

router.use('/login', loginRouter);
router.use('/signup', signupRouter);
router.use('/session', sessionRouter);
router.use('/account', accountRouter);
router.use('/news', newsRouter);
router.use('/feeds', feedRouter);
router.use('/customsearch', customSearchRouter);
router.use('/profile', profileRouter);
router.use('/briefing', briefingRouter);
router.use('/affairs', affairRouter);
// the map "The FIFA presidency": the position of the associations on the candidates (the session of a reader, see fifa-router.js)
router.use('/fifa', fifaRouter);
router.use('/entities', entityRouter);
router.use('/mails', mailRouter);
// for another system, by key (not by session): /api/v1/subjects, /api/v1/positions
router.use('/v1', v1Router);

export default router;