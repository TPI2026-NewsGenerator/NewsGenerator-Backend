//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: test.public-url.js
//  Description: Tests for the check of the urls given by a user (SSRF protection)
//

import {isPrivateIp, assertPublicUrl, decodeBody, readText} from '../../services/utils/public-url.js'

describe('isPrivateIp', () => {
    it('should refuse the addresses of the server and its network', () => {
        // 169.254.169.254 is the cloud metadata service, it holds the credentials of the server
        const privateIps = ['0.0.0.0', '10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1',
            '192.168.1.1', '192.0.0.1', '192.0.2.1', '100.64.0.1', '224.0.0.1',
            '::1', '::', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1'];

        privateIps.forEach(ip => expect([ip, isPrivateIp(ip)]).toEqual([ip, true]));
    });

    it('should accept public addresses', () => {
        // 192.0.66.x is public (techcrunch.com), only 192.0.0.0/24 and 192.0.2.0/24 are reserved
        const publicIps = ['8.8.8.8', '93.184.216.34', '151.101.1.140', '192.0.66.2', '192.1.0.1',
            '2606:2800:220:1:248:1893:25c8:1946'];

        publicIps.forEach(ip => expect([ip, isPrivateIp(ip)]).toEqual([ip, false]));
    });

    it('should refuse what is not an address', () => {
        expect(isPrivateIp('not an ip')).toBe(true);
        expect(isPrivateIp('')).toBe(true);
    });
});

describe('assertPublicUrl', () => {
    it('should refuse another protocol than http and https', async () => {
        await expect(assertPublicUrl('file:///etc/passwd')).rejects.toMatchObject({status: 400});
        await expect(assertPublicUrl('ftp://example.com')).rejects.toMatchObject({status: 400});
    });

    it('should refuse what is not an address', async () => {
        await expect(assertPublicUrl('not an address')).rejects.toMatchObject({status: 400});
    });

    it('should refuse the server itself', async () => {
        await expect(assertPublicUrl('http://localhost:3001/api/news')).rejects.toMatchObject({status: 400});
        await expect(assertPublicUrl('http://127.0.0.1/')).rejects.toMatchObject({status: 400});
    });
});

// the bytes of a text in ISO-8859-1: one byte a letter, "ã" is 0xE3
const latin1 = (value) => Uint8Array.from(value, c => c.charCodeAt(0));

describe('decodeBody', () => {
    // record.pt: Content-Type "text/xml", the charset only in its declaration
    it('should read a feed in the charset its XML declaration gives', () => {
        const xml = '<?xml version="1.0" encoding="iso-8859-1"?><rss><title>Dragão</title></rss>';
        expect(decodeBody(latin1(xml), 'text/xml')).toBe(xml);
    });

    it('should read a page in the charset of its <meta>', () => {
        const html = '<html><head><meta charset="windows-1252"></head><body>média</body></html>';
        expect(decodeBody(latin1(html), 'text/html')).toBe(html);
    });

    it('should prefer the charset of Content-Type', () => {
        const xml = '<?xml version="1.0" encoding="utf-8"?><t>Dragão</t>';
        expect(decodeBody(latin1(xml), 'text/xml; charset=ISO-8859-1')).toBe(xml);
    });

    it('should read UTF-8 when nothing is declared, or a charset it does not know', () => {
        const bytes = new TextEncoder().encode('<t>Dragão</t>');
        expect(decodeBody(bytes, null)).toBe('<t>Dragão</t>');
        expect(decodeBody(bytes, 'text/xml; charset=unknown-charset')).toBe('<t>Dragão</t>');
    });

    it('should ignore a declaration of UTF-16 read in ASCII', () => {
        const bytes = new TextEncoder().encode('<?xml version="1.0" encoding="UTF-16"?><t>Dragão</t>');
        expect(decodeBody(bytes, 'text/xml')).toBe('<?xml version="1.0" encoding="UTF-16"?><t>Dragão</t>');
    });

    it('should be what readText gives', async () => {
        const xml = '<?xml version="1.0" encoding="iso-8859-1"?><t>Dragão</t>';
        expect(await readText(new Response(latin1(xml), {headers: {'content-type': 'text/xml'}}))).toBe(xml);
    });
});
