//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: news-export-controller.js
//  Description: Controller for GET /api/v1/news: the news that name a person and/or an association, for the system of another party.
//               The parameters are checked here (a refusal is a 422 that names the parameter), the answer comes from news-export-service.js
//

"use strict"

import {NewsExportService, decodeCursor, isServed} from '../services/news-export-service.js';
import {COUNTRY_CODE} from '../services/utils/football-associations.js';
import {QID, fail, flag, integer, invalid, list, moment, oneOf, param} from '../services/utils/v1-params.js';

const MAX_LIMIT = 200;
const INCLUDES = ['entities', 'marks'];
const qid = (value, name) => {
    if (!QID.test(value)) throw invalid(name, `QIDs of Wikidata, as Q124138, separated by commas (${value} is none).`);
    return value;
};

// 4 characters at least in the scripts with words between blanks (a shorter one finds everything), 2 in the others, whose names are short
const term = (value, name) => {
    const least = isServed(value) ? 4 : 2;
    if (value.length < least || value.length > 40) throw invalid(name, `words of ${least} to 40 characters, separated by commas (${value} has ${value.length}).`);
    return value;
};

const country = (value, name) => {
    const code = value.toUpperCase();
    if (!COUNTRY_CODE.test(code)) throw invalid(name, `codes of two letters, as JP, or GB-WLS for a nation of the United Kingdom (${value} is none).`);
    return code;
};

const language = (value, name) => {
    if (!/^[a-z]{2,3}$/.test(value)) throw invalid(name, `codes of language, as en,fr (${value} is none).`);
    return value;
};

const medium = (value, name) => {
    const domain = value.toLowerCase();
    if (!/^[a-z0-9][a-z0-9.-]{1,60}$/.test(domain)) throw invalid(name, `domains of media, as bbc.co.uk (${value} is none).`);
    return domain;
};

export const NewsExportController = {
    // {items: [{id, title, description, url, medium, lang, published_at, seen_at, story, matched}], next_cursor, has_more, retention_days, order}
    list: async (req, res) => {
        try {
            const query = {
                persons: list(req, 'person', {max: 5, each: qid}),
                terms: list(req, 'q', {max: 10, each: term}),
                associations: list(req, 'association', {max: 20, each: qid}),
                countries: list(req, 'country', {max: 10, each: country}),
                langs: list(req, 'lang', {max: 10, each: language}),
                media: list(req, 'medium', {max: 20, each: medium}),
                excludedMedia: list(req, 'exclude_medium', {max: 20, each: medium}),
                since: moment(req, 'since'),
                until: moment(req, 'until'),
                hasText: flag(req, 'has_text'),
                dedupe: oneOf(req, 'dedupe', ['story'], null),
                order: oneOf(req, 'order', ['asc', 'desc'], 'asc'),
                limit: integer(req, 'limit', {min: 1, max: MAX_LIMIT, fallback: 50}),
                include: new Set(list(req, 'include', {max: INCLUDES.length, each: (value, name) => {
                    if (!INCLUDES.includes(value)) throw invalid(name, `${INCLUDES.join(', ')}.`);
                    return value;
                }})),
                after: null,
            };
            // never the whole base: a person, words or an association is asked
            if (query.persons.length + query.terms.length + query.associations.length + query.countries.length === 0) {
                throw invalid('person', 'at least one of person, q, association or country is needed.', 'missing_filter');
            }
            // A word in Chinese, Japanese, Korean, Thai... is not found by an index: it is read in the news of an association, never in all of them
            const scanned = query.terms.find(word => !isServed(word));
            if (scanned && query.associations.length + query.countries.length === 0) {
                throw invalid('q', `${scanned} is in a script that is only read in the news of an association: ask also for association= or country= (the Japan FA and the name of a person in Japanese), or ask for the person by their QID (person=Q...), which finds them in every script.`, 'unsupported_script');
            }
            if (query.since && query.until && query.since >= query.until) throw invalid('until', 'after since.');
            const cursor = param(req, 'cursor');
            if (cursor !== undefined) {
                query.after = decodeCursor(cursor);
                if (query.after === null) throw invalid('cursor', 'the next_cursor of a previous answer, as it was given.');
            }

            // asked again within a minute a client can keep the answer; private: for the holder of the key, no shared cache keeps it
            res.set('Cache-Control', 'private, max-age=60');
            res.status(200).json(await NewsExportService.list(query));
        } catch (error) {
            fail(res, error);
        }
    },
};
