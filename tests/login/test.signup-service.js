//
//  Author: Fabian Rostello
//  Date: 29.09.2026
//  File: test.signup-service.js
//  Description: An account is created with its profile, or not at all
//

import {jest} from '@jest/globals';

jest.unstable_mockModule('../../models/user-model.js', () => ({
    UserModel: {
        taken: jest.fn(),
        roleId: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
    },
}));
jest.unstable_mockModule('../../services/profile-service.js', () => ({
    ProfileService: {
        prepare: jest.fn(),
        store: jest.fn(),
    },
}));
jest.unstable_mockModule('../../services/utils/pwd-hasher.js', () => ({
    hashWithSalt: jest.fn(),
}));
jest.unstable_mockModule('../../services/utils/jwt.js', () => ({
    generateAccessToken: jest.fn(),
}));

const {SignupService} = await import('../../services/signup-service.js');
const {UserModel} = await import('../../models/user-model.js');
const {ProfileService} = await import('../../services/profile-service.js');
const {hashWithSalt} = await import('../../services/utils/pwd-hasher.js');
const {generateAccessToken} = await import('../../services/utils/jwt.js');
const {rateLimit} = await import('../../services/utils/rate-limit.js');

const request = {
    username: 'lecteur',
    email: 'lecteur@example.org',
    password: 'a long password',
    text: 'The Premier League and the tactics of its coaches',
    language: 'en',
};
const prepared = {profile: {text: request.text}, interests: [{text: 'Premier League'}]};

describe('SignupService.register', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        UserModel.taken.mockResolvedValue(false);
        UserModel.roleId.mockResolvedValue(2);
        UserModel.create.mockResolvedValue({id: 300, username: 'lecteur', email: 'lecteur@example.org', role: 2});
        ProfileService.prepare.mockResolvedValue(prepared);
        ProfileService.store.mockResolvedValue();
        UserModel.delete.mockResolvedValue({});
        hashWithSalt.mockResolvedValue('hashed');
        generateAccessToken.mockReturnValue('token');
    });

    it('should create the account with a hashed password, save its profile and sign it in', async () => {
        await expect(SignupService.register(request)).resolves.toEqual({id_user: 300, token: 'token'});

        expect(UserModel.create).toHaveBeenCalledWith({username: 'lecteur', email: 'lecteur@example.org', password: 'hashed', role: 2});
        expect(ProfileService.prepare).toHaveBeenCalledWith({text: request.text, topics: undefined, language: 'en'});
        expect(ProfileService.store).toHaveBeenCalledWith(300, prepared);
    });

    it.each([
        [{username: 'ab'}, /username/],
        [{username: 'le lecteur'}, /username/],
        [{email: 'lecteur@'}, /email/],
        [{password: 'short'}, /password/],
        [{password: 'é'.repeat(40)}, /password/],
    ])('should refuse %o before anything is read or created', async (change, message) => {
        await expect(SignupService.register({...request, ...change})).rejects.toMatchObject({status: 400, message: expect.stringMatching(message)});
        expect(ProfileService.prepare).not.toHaveBeenCalled();
        expect(UserModel.create).not.toHaveBeenCalled();
    });

    it('should refuse a name or an email already used without asking the AI', async () => {
        UserModel.taken.mockResolvedValue(true);

        await expect(SignupService.register(request)).rejects.toMatchObject({status: 409});
        expect(ProfileService.prepare).not.toHaveBeenCalled();
    });

    it('should create no account when the AI reads no interest in the profile', async () => {
        ProfileService.prepare.mockRejectedValue(Object.assign(new Error('No interest'), {status: 422}));

        await expect(SignupService.register(request)).rejects.toMatchObject({status: 422});
        expect(UserModel.create).not.toHaveBeenCalled();
    });

    it('should answer 409 when the name is taken meanwhile', async () => {
        UserModel.create.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), {code: 'P2002'}));

        await expect(SignupService.register(request)).rejects.toMatchObject({status: 409});
    });

    it('should remove the account when its profile cannot be saved', async () => {
        ProfileService.store.mockRejectedValue(new Error('database down'));

        await expect(SignupService.register(request)).rejects.toThrow('database down');
        expect(UserModel.delete).toHaveBeenCalledWith(300);
    });
});

describe('rateLimit', () => {
    const response = () => {
        const res = {headers: {}};
        res.set = jest.fn((name, value) => { res.headers[name] = value; return res; });
        res.status = jest.fn(() => res);
        res.json = jest.fn(() => res);
        return res;
    };

    it('should let a few requests of an address through, then answer 429', () => {
        const limit = rateLimit({windowMs: 60000, max: 2, message: 'Too many'});
        const next = jest.fn();

        limit({ip: '1.2.3.4'}, response(), next);
        limit({ip: '1.2.3.4'}, response(), next);
        const res = response();
        limit({ip: '1.2.3.4'}, res, next);
        limit({ip: '5.6.7.8'}, response(), next);

        expect(next).toHaveBeenCalledTimes(3);
        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith({error: 'Too many'});
        expect(Number(res.headers['Retry-After'])).toBeGreaterThan(0);
    });
});
