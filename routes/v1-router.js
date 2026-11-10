//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: v1-router.js
//  Description: Router of /api/v1, the read-only routes another system reads with its key (the map of the
//               positions of the associations): no session of a reader here, see api-key.js
//

import process from 'node:process';
import express from 'express'
import {NewsExportController} from '../controllers/news-export-controller.js';
import {PositionsController} from '../controllers/positions-controller.js';
import {apiError, apiKey} from "../services/utils/api-key.js";
import {rateLimit} from "../services/utils/rate-limit.js";

const router = express.Router();

// every route needs a key, and each key has its own count: 60 a minute is far more than a map that keeps the
// list a few minutes asks
router.use(apiKey);
router.use(rateLimit({
    windowMs: 60e3, max: 60,
    key: req => `v1 ${req.apiClient}`,
    message: 'Too many requests: 60 a minute for a key.',
    body: (message, retryAfter) => ({error: {code: 'rate_limited', message, retryAfter}}),
}));

// the news that name a person and/or an association, which the other party reads its own way (the first thing it is given)
router.get('/news', NewsExportController.list);

// The positions computed by us (fixed answers, see positions-service.js) are set aside since 10.11.2026: the friend reads the news and
// does the work himself. Served only when V1_POSITIONS_MOCK=on, never by default, so that a deploy shows nothing made up
const parked = (req, res, next) => process.env.V1_POSITIONS_MOCK === 'on'
    ? next()
    : apiError(res, 404, 'not_found', 'No such route in /api/v1.');
router.get('/subjects', parked, PositionsController.subjects);
router.get('/positions', parked, PositionsController.positions);
// before /positions/:id, or "changes" would be taken for an association
router.get('/positions/changes', parked, PositionsController.changes);
router.get('/positions/:id', parked, PositionsController.association);

// the same form of error as the rest of the group, not the page of Express
router.use((req, res) => apiError(res, 404, 'not_found', 'No such route in /api/v1.'));

export default router;
