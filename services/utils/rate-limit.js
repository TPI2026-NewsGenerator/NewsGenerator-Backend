//
//  Author: Fabian Rostello
//  Date: 29.09.2026
//  File: rate-limit.js
//  Description: At most a few requests per address in a window, for the routes that cost the AI and
//               the web something to anyone, like creating an account
//

"use strict"

const CLEAN_AT = 10000;     // addresses remembered before the old ones are forgotten

// kept in memory: one server, and a restart only gives a few more tries. key: who is counted, the
// address of the request by default (an account, after authenticateToken)
export const rateLimit = ({windowMs, max, message, key = (req) => req.ip}) => {
    const hits = new Map();

    return (req, res, next) => {
        const now = Date.now();
        const who = key(req);
        const recent = (hits.get(who) ?? []).filter(at => now - at < windowMs);

        if (recent.length >= max) {
            res.set('Retry-After', String(Math.ceil((recent[0] + windowMs - now) / 1000)));
            return res.status(429).json({error: message});
        }

        recent.push(now);
        hits.set(who, recent);

        if (hits.size > CLEAN_AT) {
            for (const [ip, times] of hits) {
                if (times.every(at => now - at >= windowMs)) hits.delete(ip);
            }
        }
        next();
    };
};
