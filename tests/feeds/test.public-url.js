//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: test.public-url.js
//  Description: Tests for the check of the urls given by a user (SSRF protection)
//

import {isPrivateIp, assertPublicUrl} from '../../services/utils/public-url.js'

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
