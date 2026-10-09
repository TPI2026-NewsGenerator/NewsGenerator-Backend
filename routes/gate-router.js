//
//  Author: Fabian Rostello
//  Date: 09.10.2026
//  File: gate-router.js
//  Description: Router of the password of the site (see site-gate.js)
//

import express from 'express'
import {GateController, page} from "../controllers/gate-controller.js";
import {rateLimit} from "../services/utils/rate-limit.js";
import {safeNext} from "../services/utils/site-gate.js";

const router = express.Router();

const TOO_MANY = 'Too many tries from here, try again in 15 minutes.';

// served on the internet: passwords tried one after another from one address are stopped, and told
// on the page, not in JSON: the reader sent a form
const limit = rateLimit({windowMs: 15 * 60 * 1000, max: 10, message: TOO_MANY});
const gateLimit = (req, res, next) => limit(req, {
    set: (name, value) => res.set(name, value),
    status: (status) => ({json: () => {
        console.warn(`Site gate: too many tries from ${req.ip}`);
        return page(res, status, {next: safeNext(req.body?.next), error: TOO_MANY});
    }}),
}, next);

router.get('/check', GateController.check);
router.post('', express.urlencoded({extended: false, limit: '2kb'}), gateLimit, GateController.enter);

export default router;
