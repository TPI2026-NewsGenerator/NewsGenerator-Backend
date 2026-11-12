//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: fifa-export-controller.js
//  Description: Controller for GET /api/v1/fifa/news: the news selected for the map "The FIFA presidency", for the system of another party. The parameters are
//               checked here (a refusal is a 422 that names the parameter), the answer comes from fifa-export-service.js
//

"use strict"

import {CERTAINTIES, FifaExportService, SELECTED} from '../services/fifa-export-service.js';
import {decodeCursor} from '../services/news-export-service.js';
import {QID, fail, integer, invalid, list, moment, oneOf, param} from '../services/utils/v1-params.js';

const MAX_LIMIT = 200;
const qid = (value, name) => {
    if (!QID.test(value)) throw invalid(name, `QIDs of Wikidata, as Q124138, separated by commas (${value} is none).`);
    return value;
};

export const FifaExportController = {
    // {items: [{id, updated_at, subject, association, certainty, reading, sentence, news}], next_cursor, has_more, order}
    list: async (req, res) => {
        try {
            const certainty = list(req, 'certainty', {max: CERTAINTIES.length, each: (value, name) => {
                if (!CERTAINTIES.includes(value)) throw invalid(name, `${CERTAINTIES.join(', ')}.`);
                return value;
            }});
            const query = {
                certainty: certainty.length > 0 ? certainty : SELECTED,
                subjects: list(req, 'subject', {max: 6, each: qid}),
                members: list(req, 'association', {max: 20, each: qid}),
                since: moment(req, 'since'),
                until: moment(req, 'until'),
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
            res.status(200).json(await FifaExportService.list(query));
        } catch (error) {
            fail(res, error);
        }
    },
};
