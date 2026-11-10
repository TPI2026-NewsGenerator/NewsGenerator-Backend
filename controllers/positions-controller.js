//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: positions-controller.js
//  Description: Controller for /api/v1: the parameters are checked here (a refusal is a 422 that names the
//               parameter), the answers come from positions-service.js
//

"use strict"

import {PositionsService} from '../services/positions-service.js';
import {QID, day, fail, integer, invalid, oneOf, param} from '../services/utils/v1-params.js';

const STATUSES = ['incumbent', 'declared', 'rumoured', 'withdrawn'];
const KINDS = ['reversal', 'first', 'weakened'];
const LANGUAGES = ['fr', 'en'];
const MAX_LIMIT = 200;

const subject = (req, required) => {
    const value = param(req, 'subject');
    if (value === undefined) {
        if (required) throw invalid('subject', 'the QID of the person, as Q124138 (GET /api/v1/subjects lists them).');
        return null;
    }
    if (!QID.test(value)) throw invalid('subject', 'a QID, as Q124138.');
    return value;
};

const limit = (req) => integer(req, 'limit', {min: 1, max: MAX_LIMIT, fallback: 50});

// Asked again within the minute, a client can keep the answer; private: the answer is for the holder of the key, no
// shared cache (Cloudflare) keeps it. The header tells a client that the answer is a fixed one
const answer = (res, body) => {
    res.set('Cache-Control', 'private, max-age=60');
    res.set('X-NewsGenerator-Data', PositionsService.source);
    res.status(200).json(body);
};

export const PositionsController = {
    // {subjects: [{qid, name, status, status_since, state, positions_known, news_30d}]}
    subjects: (req, res) => {
        try {
            answer(res, PositionsService.subjects({status: oneOf(req, 'status', STATUSES, null)}));
        } catch (error) {
            fail(res, error);
        }
    },

    // {subject, updated_at, positions: [one per association]}
    positions: (req, res) => {
        try {
            const person = subject(req, true);
            const confederations = oneOf(req, 'include', ['confederations'], null) === 'confederations';
            // lang is not used by the list (no sentence in it), but a wrong one is still refused: the same calls work later
            oneOf(req, 'lang', LANGUAGES, 'fr');
            answer(res, PositionsService.positions({subject: person, confederations}));
        } catch (error) {
            fail(res, error);
        }
    },

    // the position of one association and its signals, or on every person followed when no subject is given
    association: (req, res) => {
        try {
            answer(res, PositionsService.association({
                id: req.params.id,
                subject: subject(req, false),
                since: day(req, 'since', false),
                limit: limit(req),
                lang: oneOf(req, 'lang', LANGUAGES, 'fr'),
            }));
        } catch (error) {
            fail(res, error);
        }
    },

    // {subject, changes: [{association, kind, from, to, at, signal_id}]}
    changes: (req, res) => {
        try {
            answer(res, PositionsService.changes({
                subject: subject(req, true),
                since: day(req, 'since', true),
                kind: oneOf(req, 'kind', KINDS, null),
            }));
        } catch (error) {
            fail(res, error);
        }
    },
};
