//
//  Author: Fabian Rostello
//  Date: 12.10.2026
//  File: test.session-route.js
//  Description: Who the signed in reader is, their username and email as the database has them now,
//               not as their session token had them when it was made
//

import http from 'node:http';
import {afterAll, beforeAll, describe, expect, it, jest} from '@jest/globals';
import express from 'express';

const email = jest.fn();
jest.unstable_mockModule('../../services/utils/jwt.js', () => ({
    authenticateToken: (req, res, next) => { req.user = {id: 482, username: 'old-name', email: 'old@example.org', role: 2}; next(); },
    endSession: () => {},
}));
jest.unstable_mockModule('../../services/utils/admin.js', () => ({isAdmin: async () => false}));
jest.unstable_mockModule('../../models/user-model.js', () => ({UserModel: {email}}));
const {default: sessionRouter} = await import('../../routes/session-router.js');

const app = express();
app.use('/api/session', sessionRouter);

let server;
beforeAll(async () => { await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); }); });
afterAll(() => server.close());

const get = () => new Promise((resolve, reject) => {
    http.get({host: '127.0.0.1', port: server.address().port, path: '/api/session'}, res => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { text += chunk; });
        res.on('end', () => resolve({status: res.statusCode, body: JSON.parse(text)}));
    }).on('error', reject);
});

describe('GET /api/session', () => {
    it('should give the username and the email the account has now', async () => {
        email.mockResolvedValueOnce({username: 'new-name', email: 'new@example.org'});
        const res = await get();
        expect(res.status).toBe(200);
        expect(res.body).toEqual({id: 482, username: 'new-name', email: 'new@example.org', role: 2, admin: false});
        expect(email).toHaveBeenCalledWith(482);
    });

    it('should give the ones of the token when the account is not found', async () => {
        email.mockResolvedValueOnce(null);
        const res = await get();
        expect(res.body).toMatchObject({username: 'old-name', email: 'old@example.org'});
    });
});
