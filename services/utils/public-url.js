//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: public-url.js
//  Description: Checks an url given by a user before the server fetches it (SSRF protection)
//

"use strict"

import dns from 'node:dns/promises';
import net from 'node:net';

// an ip the server must never fetch for a user: its own network, the cloud metadata service...
export const isPrivateIp = (ip) => {
    // "::ffff:10.0.0.1" is an IPv4 address written as IPv6
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) ip = mapped[1];

    if (net.isIPv4(ip)) {
        const [a, b, c] = ip.split('.').map(Number);
        return a === 0                                  // 0.0.0.0/8
            || a === 10                                 // private
            || a === 127                                // loopback
            || (a === 100 && b >= 64 && b <= 127)       // carrier grade nat
            || (a === 169 && b === 254)                 // link local, cloud metadata (169.254.169.254)
            || (a === 172 && b >= 16 && b <= 31)        // private
            || (a === 192 && b === 168)                 // private
            || (a === 192 && b === 0 && c === 0)        // protocol assignments (192.0.66.x is public, techcrunch)
            || (a === 192 && b === 0 && c === 2)        // documentation
            || (a === 198 && (b === 18 || b === 19))    // benchmarking
            || (a === 198 && b === 51 && c === 100)     // documentation
            || (a === 203 && b === 0 && c === 113)      // documentation
            || a >= 224;                                // multicast and reserved
    }

    if (net.isIPv6(ip)) {
        const address = ip.toLowerCase();
        return address === '::' || address === '::1'    // unspecified, loopback
            || /^f[cd]/.test(address)                   // unique local
            || /^fe[89ab]/.test(address);               // link local
    }

    return true;    // not an ip we understand
};

// throws when the url can't be fetched for a user, returns the url otherwise
export const assertPublicUrl = async (value) => {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw Object.assign(new Error(`"${value}" is not a valid address.`), {status: 400});
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw Object.assign(new Error('Only http and https addresses are allowed.'), {status: 400});
    }

    // every ip behind the name must be public, a name can have several
    let addresses;
    try {
        addresses = await dns.lookup(url.hostname, {all: true});
    } catch {
        throw Object.assign(new Error(`"${url.hostname}" does not exist.`), {status: 400});
    }

    if (addresses.some(address => isPrivateIp(address.address))) {
        throw Object.assign(new Error(`"${url.hostname}" is a private address, it can't be used.`), {status: 400});
    }

    return url;
};

// fetch following the redirects one by one, checking each of them (a public url can redirect to a private one)
export const fetchPublicUrl = async (value, {headers = {}, timeoutMs = 15000, maxRedirects = 3} = {}) => {
    let url = await assertPublicUrl(value);

    for (let redirects = 0; ; redirects++) {
        const res = await fetch(url, {headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs)});

        const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
        if (!location) return {res, url: url.href};

        if (redirects >= maxRedirects) {
            throw Object.assign(new Error('Too many redirects.'), {status: 400});
        }
        url = await assertPublicUrl(new URL(location, url).href);
    }
};

// hostname of an url without its "www.", null when it is not an url: "https://www.bbc.com/x" -> "bbc.com"
export const hostOf = (value) => {
    try {
        return new URL(value).hostname.replace(/^www\./, '');
    } catch {
        return null;
    }
};

// "bbc.co.uk" is not the ".uk" of "bbc": these endings need one label more to name a medium
const TWO_LEVEL_TLDS = ['co.uk', 'org.uk', 'com.au', 'net.au', 'co.nz', 'co.jp', 'co.za', 'co.in', 'com.br'];

// the medium behind a hostname, so "rss.cnn.com" and "edition.cnn.com" are seen as the same one
export const mediumOf = (host) => {
    const labels = host.split('.');
    const twoLast = labels.slice(-2).join('.');
    return TWO_LEVEL_TLDS.includes(twoLast) ? labels.slice(-3).join('.') : twoLast;
};
