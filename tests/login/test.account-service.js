//
//  Author: Fabian Rostello
//  Date: 02.10.2026
//  File: test.account-service.js
//  Description: The username, the email and the password of an account changed only with the password of now
//

import {jest} from '@jest/globals';

jest.unstable_mockModule('../../models/user-model.js', () => ({
    UserModel: {
        withPassword: jest.fn(),
        nameTakenByOther: jest.fn(),
        emailTakenByOther: jest.fn(),
        update: jest.fn(),
    },
}));
jest.unstable_mockModule('../../services/utils/pwd-hasher.js', () => ({
    hashWithSalt: jest.fn(),
    verifyPassword: jest.fn(),
}));
jest.unstable_mockModule('../../services/utils/jwt.js', () => ({
    generateAccessToken: jest.fn(),
}));
jest.unstable_mockModule('../../services/utils/password-changes.js', () => ({
    notePasswordChange: jest.fn(),
}));

const {AccountService} = await import('../../services/account-service.js');
const {UserModel} = await import('../../models/user-model.js');
const {hashWithSalt, verifyPassword} = await import('../../services/utils/pwd-hasher.js');
const {generateAccessToken} = await import('../../services/utils/jwt.js');
const {notePasswordChange} = await import('../../services/utils/password-changes.js');

const account = {id: 300, username: 'lecteur', email: 'lecteur@example.org', role: 2, password: 'hash'};
const {password: _hash, ...publicAccount} = account;

beforeEach(() => {
    jest.clearAllMocks();
    UserModel.withPassword.mockResolvedValue(account);
    UserModel.nameTakenByOther.mockResolvedValue(false);
    UserModel.emailTakenByOther.mockResolvedValue(false);
    UserModel.update.mockImplementation(async (id, data) => ({...publicAccount, ...('username' in data || 'email' in data ? data : {})}));
    verifyPassword.mockImplementation(async (password) => password === 'the current one');
    hashWithSalt.mockResolvedValue('new hash');
    generateAccessToken.mockReturnValue('token');
});

describe('AccountService.rename', () => {
    it('should change the name with the current password, and give a session with it', async () => {
        await expect(AccountService.rename(300, {username: ' lecteur.2 ', password: 'the current one'}))
            .resolves.toEqual({user: {...publicAccount, username: 'lecteur.2'}, token: 'token'});
        expect(UserModel.update).toHaveBeenCalledWith(300, {username: 'lecteur.2'});
        expect(generateAccessToken).toHaveBeenCalledWith({...publicAccount, username: 'lecteur.2'});
    });

    it('should change nothing without the current password, or for a name not allowed or taken', async () => {
        await expect(AccountService.rename(300, {username: 'lecteur.2', password: 'a guess'})).rejects.toMatchObject({status: 401});
        await expect(AccountService.rename(300, {username: 'le lecteur', password: 'the current one'})).rejects.toMatchObject({status: 400});
        UserModel.nameTakenByOther.mockResolvedValue(true);
        await expect(AccountService.rename(300, {username: 'Autre', password: 'the current one'})).rejects.toMatchObject({status: 409});
        expect(UserModel.update).not.toHaveBeenCalled();
    });

    it('should say a name taken meanwhile is taken', async () => {
        UserModel.update.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), {code: 'P2002'}));
        await expect(AccountService.rename(300, {username: 'autre', password: 'the current one'})).rejects.toMatchObject({status: 409});
    });
});

describe('AccountService.changeEmail', () => {
    it('should change the email with the current password, and give a session with it', async () => {
        await expect(AccountService.changeEmail(300, {email: ' nouveau@example.org ', password: 'the current one'}))
            .resolves.toEqual({user: {...publicAccount, email: 'nouveau@example.org'}, token: 'token'});
        expect(UserModel.update).toHaveBeenCalledWith(300, {email: 'nouveau@example.org'});
        expect(generateAccessToken).toHaveBeenCalledWith({...publicAccount, email: 'nouveau@example.org'});
    });

    it('should change nothing without the current password, or for an email not valid or of another account', async () => {
        await expect(AccountService.changeEmail(300, {email: 'nouveau@example.org', password: 'a guess'})).rejects.toMatchObject({status: 401});
        await expect(AccountService.changeEmail(300, {email: 'pas un email', password: 'the current one'})).rejects.toMatchObject({status: 400});
        await expect(AccountService.changeEmail(300, {password: 'the current one'})).rejects.toMatchObject({status: 400});
        UserModel.emailTakenByOther.mockResolvedValue(true);
        await expect(AccountService.changeEmail(300, {email: 'Autre@example.org', password: 'the current one'})).rejects.toMatchObject({status: 409});
        expect(UserModel.update).not.toHaveBeenCalled();
    });

    it('should say an email taken meanwhile is taken', async () => {
        UserModel.update.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), {code: 'P2002'}));
        await expect(AccountService.changeEmail(300, {email: 'autre@example.org', password: 'the current one'})).rejects.toMatchObject({status: 409});
    });
});

describe('AccountService.changePassword', () => {
    it('should keep only the hash of the new password, and end the sessions opened before', async () => {
        await expect(AccountService.changePassword(300, {password: 'the current one', newPassword: 'a new long password'}))
            .resolves.toEqual({user: publicAccount, token: 'token'});
        expect(hashWithSalt).toHaveBeenCalledWith('a new long password');
        const [, data] = UserModel.update.mock.calls[0];
        expect(data.password).toBe('new hash');
        const at = data.password_changed_at.getTime() / 1000;
        expect(Math.abs(at - Date.now() / 1000)).toBeLessThan(5);
        expect(notePasswordChange).toHaveBeenCalledWith(300, at);
    });

    it('should change nothing without the current password, for a short one or for the same one', async () => {
        await expect(AccountService.changePassword(300, {password: 'a guess', newPassword: 'a new long password'})).rejects.toMatchObject({status: 401});
        await expect(AccountService.changePassword(300, {password: 'the current one', newPassword: 'short'})).rejects.toMatchObject({status: 400});
        await expect(AccountService.changePassword(300, {password: 'the current one', newPassword: 'the current one'})).rejects.toMatchObject({status: 400});
        await expect(AccountService.changePassword(300, {password: 'the current one', newPassword: 'é'.repeat(37)})).rejects.toMatchObject({status: 400});
        expect(UserModel.update).not.toHaveBeenCalled();
        expect(notePasswordChange).not.toHaveBeenCalled();
    });
});
