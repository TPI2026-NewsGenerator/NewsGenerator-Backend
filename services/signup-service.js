//
//  Author: Fabian Rostello
//  Date: 29.09.2026
//  File: signup-service.js
//  Description: A reader creates their account with their profile: nothing is read for them without
//               it, so the account and its first sources come at once
//

"use strict"

import {hashWithSalt} from './utils/pwd-hasher.js';
import {generateAccessToken} from './utils/jwt.js';
import {UserModel} from '../models/user-model.js';
import {ProfileService} from './profile-service.js';
import {isPassword, isTaken, isUsername, PASSWORD_RULE, USERNAME_RULE} from './utils/account-rules.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL = 254;
const READER_ROLE = 'User';

const fail = (status, message) => Object.assign(new Error(message), {status});

export const SignupService = {
    // -> {id_user, token}, as the login: the reader is signed in at once
    register: async ({username, email, password, text, language}) => {
        const name = typeof username === 'string' ? username.trim() : '';
        const mail = typeof email === 'string' ? email.trim() : '';

        if (!isUsername(name)) {
            throw fail(400, USERNAME_RULE);
        }
        if (mail.length > MAX_EMAIL || !EMAIL.test(mail)) {
            throw fail(400, 'Enter a valid email.');
        }
        if (!isPassword(password)) {
            throw fail(400, PASSWORD_RULE);
        }
        // before the AI reads the profile: a name taken costs nothing
        if (await UserModel.taken(name, mail)) {
            throw fail(409, 'This username or this email is already used.');
        }

        // the profile is read before the account is created: a text the AI finds no interest in
        // leaves no account behind, the reader only writes it again
        const profile = await ProfileService.prepare({text, language});

        const role = await UserModel.roleId(READER_ROLE);
        if (role === null) throw fail(500, `The role "${READER_ROLE}" is missing from the database.`);

        let user;
        try {
            user = await UserModel.create({username: name, email: mail, password: await hashWithSalt(password), role});
        } catch (error) {
            if (isTaken(error)) throw fail(409, 'This username or this email is already used.');
            throw error;
        }

        try {
            await ProfileService.store(user.id, profile);
        } catch (error) {
            // the reader tries again with the same name: it must not be taken by an account without profile
            await UserModel.delete(user.id).catch(err => console.error(`Signup: account ${user.id} left without profile (${err.message})`));
            throw error;
        }

        return {id_user: user.id, token: generateAccessToken(user)};
    },
};
