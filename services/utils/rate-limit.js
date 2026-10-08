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
// address of the request by default (an account, after authenticateToken). cost: what a request
// counts for, 1 by default (the sites of a list checked), 'max' at most in the window
export const rateLimit = ({windowMs, max, message, key = (req) => req.ip, cost = () => 1}) => {
    const hits = new Map();         // who -> [{at, cost}], the oldest first

    return (req, res, next) => {
        const now = Date.now();
        const who = key(req);
        const spent = Math.min(max, Math.max(1, cost(req)));
        const recent = (hits.get(who) ?? []).filter(hit => now - hit.at < windowMs);
        const used = recent.reduce((sum, hit) => sum + hit.cost, 0);

        if (used + spent > max) {
            // the time until enough of the oldest are out of the window for this one
            let freed = 0;
            const last = recent.find(hit => (freed += hit.cost) >= used + spent - max) ?? recent.at(-1);
            const retryAfter = Math.ceil((last.at + windowMs - now) / 1000);
            res.set('Retry-After', String(retryAfter));
            // in the answer too: a client of another origin can not read the header
            return res.status(429).json({error: message, retryAfter});
        }

        recent.push({at: now, cost: spent});
        hits.set(who, recent);

        if (hits.size > CLEAN_AT) {
            for (const [ip, times] of hits) {
                if (times.every(hit => now - hit.at >= windowMs)) hits.delete(ip);
            }
        }
        next();
    };
};
