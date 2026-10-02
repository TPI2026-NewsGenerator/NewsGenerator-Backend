//
//  Author: Fabian Rostello
//  Date: 02.10.2026
//  File: account-service.js
//  Description: The settings of an account: its username and its password, each changed only with
//               the password of now
//

"use strict"

import {hashWithSalt, verifyPassword} from './utils/pwd-hasher.js';
import {generateAccessToken} from './utils/jwt.js';
import {notePasswordChange} from './utils/password-changes.js';
import {UserModel} from '../models/user-model.js';
import {isPassword, isTaken, isUsername, PASSWORD_RULE, USERNAME_RULE} from './utils/account-rules.js';

const fail = (status, message) => Object.assign(new Error(message), {status});

// The password of now is asked for each change: a session left open on another computer must not be
// enough to take the account. Never a hint of what is wrong in it
const checkedAccount = async (userId, password) => {
    const user = await UserModel.withPassword(userId);
    if (!user) throw fail(404, 'This account does not exist any more.');
    if (typeof password !== 'string' || !password || !await verifyPassword(password, user.password)) {
        throw fail(401, 'Your current password is not this one.');
    }
    return user;
};

// the account as the session tells it, and its new token: the name is in it
const signedIn = ({id, username, email, role}) => ({
    user: {id, username, email, role},
    token: generateAccessToken({id, username, email, role}),
});

export const AccountService = {
    // -> {user, token}
    rename: async (userId, {username, password}) => {
        const name = typeof username === 'string' ? username.trim() : '';
        if (!isUsername(name)) throw fail(400, USERNAME_RULE);

        const user = await checkedAccount(userId, password);
        if (name === user.username) return signedIn(user);
        if (await UserModel.nameTakenByOther(name, userId)) throw fail(409, 'This username is already used.');

        try {
            return signedIn(await UserModel.update(userId, {username: name}));
        } catch (error) {
            if (isTaken(error)) throw fail(409, 'This username is already used.');
            throw error;
        }
    },

    // -> {user, token}
    changePassword: async (userId, {password, newPassword}) => {
        if (!isPassword(newPassword)) throw fail(400, PASSWORD_RULE);
        await checkedAccount(userId, password);
        if (newPassword === password) throw fail(400, 'The new password is the current one.');

        // the sessions opened before, on the other devices, are refused from now on (see jwt.js); the
        // one of this device starts again after it
        const at = Math.floor(Date.now() / 1000);
        const user = await UserModel.update(userId, {password: await hashWithSalt(newPassword), password_changed_at: new Date(at * 1000)});
        notePasswordChange(userId, at);
        return signedIn(user);
    },
};
