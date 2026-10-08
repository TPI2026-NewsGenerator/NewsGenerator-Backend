//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: test.check-limit.js
//  Description: The sites of an imported list the server checks per hour, counted in sites and per
//               account, with the time until it checks more
//

import {afterEach, describe, expect, it, jest} from '@jest/globals';
import {rateLimit} from '../../services/utils/rate-limit.js';

const request = (user, sites) => ({ip: '203.0.113.9', user: {id: user}, body: {sites: Array.from({length: sites}, (_, i) => `https://s${i}.example`)}});
const response = () => {
    const res = {headers: {}, set: (name, value) => { res.headers[name] = value; }, status: jest.fn(() => res), json: jest.fn()};
    return res;
};

afterEach(() => jest.useRealTimers());

describe('rateLimit counted in sites', () => {
    const limit = () => rateLimit({windowMs: 3600e3, max: 50, message: 'Too many sites.', key: req => req.user.id, cost: req => req.body.sites.length});

    it('should let an account check sites up to the most, then say in how long it checks these', () => {
        jest.useFakeTimers({now: 0});
        const check = limit();
        const next = jest.fn();

        check(request(1, 25), response(), next);
        jest.advanceTimersByTime(10 * 60e3);
        check(request(1, 25), response(), next);
        expect(next).toHaveBeenCalledTimes(2);

        jest.advanceTimersByTime(10 * 60e3);
        const res = response();
        check(request(1, 5), res, next);
        expect(next).toHaveBeenCalledTimes(2);
        expect(res.status).toHaveBeenCalledWith(429);
        // the first 25 out of the window in 40 minutes
        expect(res.json).toHaveBeenCalledWith({error: 'Too many sites.', retryAfter: 40 * 60});
        expect(res.headers['Retry-After']).toBe(String(40 * 60));

        // another account is counted apart
        check(request(2, 25), response(), next);
        expect(next).toHaveBeenCalledTimes(3);

        jest.advanceTimersByTime(40 * 60e3);
        check(request(1, 5), response(), next);
        expect(next).toHaveBeenCalledTimes(4);
    });

    it('should count a request of no list as one', () => {
        const check = rateLimit({windowMs: 3600e3, max: 2, message: 'Too many.', cost: req => Array.isArray(req.body?.sites) ? req.body.sites.length : 1});
        const next = jest.fn();
        for (let i = 0; i < 3; i++) check({ip: '203.0.113.9', body: {}}, response(), next);
        expect(next).toHaveBeenCalledTimes(2);
    });
});
