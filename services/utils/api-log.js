//
//  Author: Fabian Rostello
//  Date: 11.11.2026
//  File: api-log.js
//  Description: The journal of /api/v1: one line in the log of the server for each request, the refused ones too, so that its
//               owner sees when the other party reads the news and how often (docker logs -t stamps each line with its time).
//               The client, the route, the status, how long it took, how many items an answer held and the NAMES of the
//               parameters: never a value asked (a key put in the address is a value, and the tests say no key stays in a log),
//               and the address only of a request refused for its key
//

"use strict"

const WORD = /^[a-z_]{1,24}$/i;         // a name that is no word is left out: it could be written to look like a line of the log
const MAX_NAMES = 12;
const MAX_ROUTE = 80;

// log: what writes the line, the console of the server by default. Put before the check of the key (see v1-router.js), so
// that a request with no key or a wrong one is written too, with no client
export const apiLog = (log = console) => (req, res, next) => {
    const started = Date.now();
    const route = `${req.baseUrl}${req.path}`.slice(0, MAX_ROUTE);
    const names = [...new Set(Object.keys(req.query ?? {}).filter(name => WORD.test(name)))].sort().slice(0, MAX_NAMES);
    let items = null;

    // how many items the answer held: what a client that asks again and again for the next ones is told is empty or full
    const json = res.json.bind(res);
    res.json = (body) => {
        if (Array.isArray(body?.items)) items = body.items.length;
        return json(body);
    };

    // 'close' ends every response, one that a client left before its end too
    res.on('close', () => {
        log.log([
            `API v1: ${req.apiClient ?? '-'} ${req.method} ${route} ${res.statusCode} ${Date.now() - started} ms`,
            items !== null && res.statusCode === 200 && `${items} items`,
            names.length > 0 && `params ${names.join(',')}`,
            res.statusCode === 401 && `from ${req.ip}`,
            !res.writableFinished && '(client left)',
        ].filter(Boolean).join(' '));
    });
    next();
};
