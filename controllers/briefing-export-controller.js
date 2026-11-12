//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: briefing-export-controller.js
//  Description: Controller for GET /api/v1/briefing/news: the news the briefings of all the readers chose, for the system of another party. The
//               parameters are checked here (a refusal is a 422 that names the parameter), the answer comes from briefing-export-service.js
//

"use strict"

import {BriefingExportService, decodeCursor} from '../services/briefing-export-service.js';
import {TOPICS} from '../services/utils/topics.js';
import {fail, integer, invalid, list, moment, oneOf, param} from '../services/utils/v1-params.js';

const MAX_LIMIT = 100;

export const BriefingExportController = {
    // {items: [{id, selected_at, readers, articles, key_passages, reading, names, ...}], next_cursor, has_more, order, dedupe}
    list: async (req, res) => {
        try {
            const query = {
                since: moment(req, 'since'),
                until: moment(req, 'until'),
                // the topic the card was given (sport, politics...): sport leaves most of what is not football
                topics: list(req, 'topic', {max: TOPICS.length, each: (value, name) => {
                    if (!TOPICS.includes(value)) throw invalid(name, `${TOPICS.join(', ')}.`);
                    return value;
                }}),
                // story: each story once, at the first briefing that chose it; none: every choice of every briefing
                dedupe: oneOf(req, 'dedupe', ['story', 'none'], 'story'),
                order: oneOf(req, 'order', ['asc', 'desc'], 'asc'),
                limit: integer(req, 'limit', {min: 1, max: MAX_LIMIT, fallback: 50}),
                after: null,
            };
            if (query.since && query.until && query.since >= query.until) throw invalid('until', 'after since.');
            const cursor = param(req, 'cursor');
            if (cursor !== undefined) {
                query.after = decodeCursor(cursor);
                if (query.after === null) throw invalid('cursor', 'the next_cursor of a previous answer, as it was given.');
            }

            // asked again within a minute a client can keep the answer; private: for the holder of the key, no shared cache keeps it
            res.set('Cache-Control', 'private, max-age=60');
            res.status(200).json(await BriefingExportService.list(query));
        } catch (error) {
            fail(res, error);
        }
    },
};
