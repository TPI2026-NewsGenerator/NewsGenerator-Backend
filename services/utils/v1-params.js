//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: v1-params.js
//  Description: The checks of the parameters of /api/v1, shared by its controllers: a refusal is a 422 that names the
//               parameter (see api-key.js apiError), the same one whoever asks
//

"use strict"

import {apiError} from './api-key.js';

// a QID of Wikidata, Q and a number; the made-up ones of the fixed answers (Q000010) keep their zeros, only Q0 is none
export const QID = /^Q(?!0+$)\d{1,12}$/;

export const invalid = (name, rule, code = 'invalid_parameter') => Object.assign(new Error(`${name}: ${rule}`), {status: 422, code, parameter: name});

// the value of a query parameter: undefined when it is not there, never a list (the same name twice is a mistake)
export const param = (req, name) => {
    const value = req.query[name];
    if (Array.isArray(value)) throw invalid(name, 'given once only.');
    return value === undefined || value === '' ? undefined : String(value);
};

export const oneOf = (req, name, values, fallback) => {
    const value = param(req, name);
    if (value === undefined) return fallback;
    if (!values.includes(value)) throw invalid(name, `one of ${values.join(', ')}.`);
    return value;
};

// a day that exists, as 2026-11-01
export const day = (req, name, required) => {
    const value = param(req, name);
    if (value === undefined) {
        if (required) throw invalid(name, 'a day is needed, as 2026-11-01.');
        return null;
    }
    const date = new Date(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        throw invalid(name, 'a day, as 2026-11-01.');
    }
    return value;
};

// a moment: a day, or a day and a time with its zone, as 2026-11-01T08:30:00Z; null when it is not given
export const moment = (req, name) => {
    const value = param(req, name);
    if (value === undefined) return null;
    const dated = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
    // the day must exist: a day of 31 in any month is read by the engine as the next one ("2026-02-30" is 2 March)
    const calendar = dated.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/.test(dated) || Number.isNaN(Date.parse(dated))
        || new Date(`${calendar}T00:00:00Z`).toISOString().slice(0, 10) !== calendar) {
        throw invalid(name, 'a day (2026-11-01) or a moment with its zone (2026-11-01T08:30:00Z).');
    }
    return new Date(dated).toISOString();
};

// a list of values separated by commas, each checked by `each` (which returns the value, or throws a message), none twice, `max` at most
export const list = (req, name, {max, each = (value) => value}) => {
    const value = param(req, name);
    if (value === undefined) return [];
    const items = [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))];
    if (items.length > max) throw invalid(name, `${max} values at most, separated by commas.`);
    return items.map(item => each(item, name));
};

export const integer = (req, name, {min, max, fallback}) => {
    const value = param(req, name);
    if (value === undefined) return fallback;
    if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) throw invalid(name, `a whole number from ${min} to ${max}.`);
    return Number(value);
};

export const flag = (req, name, fallback = false) => {
    const value = param(req, name);
    if (value === undefined) return fallback;
    if (value !== 'true' && value !== 'false') throw invalid(name, 'true or false.');
    return value === 'true';
};

// what a refusal or a failure becomes: the form of the errors of /api/v1; a failure of ours says nothing of what went wrong inside
export const fail = (res, error) => {
    if (error.status) return apiError(res, error.status, error.code ?? 'error', error.message, error.parameter ? {parameter: error.parameter} : {});
    console.error(`v1: ${error.stack ?? error}`);
    return apiError(res, 500, 'server_error', 'The request could not be answered right now.');
};
