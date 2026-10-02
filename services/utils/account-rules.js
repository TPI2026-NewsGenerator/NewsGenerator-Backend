//
//  Author: Fabian Rostello
//  Date: 02.10.2026
//  File: account-rules.js
//  Description: What a username and a password must be, the same at the signup and in the settings
//

"use strict"

import {Buffer} from 'node:buffer';

const USERNAME = /^[\p{L}\p{N}._-]{3,30}$/u;
export const MIN_PASSWORD = 10;
export const MAX_PASSWORD_BYTES = 72;      // bcrypt reads no further: two passwords sharing them would be one

export const USERNAME_RULE = 'A username is 3 to 30 letters, digits, dots, dashes or underscores.';
export const PASSWORD_RULE = `A password is ${MIN_PASSWORD} to ${MAX_PASSWORD_BYTES} characters.`;

export const isUsername = (name) => typeof name === 'string' && USERNAME.test(name);

export const isPassword = (password) => typeof password === 'string'
    && password.length >= MIN_PASSWORD && Buffer.byteLength(password) <= MAX_PASSWORD_BYTES;

// a unique index refusing a name or an email: taken meanwhile by another account
export const isTaken = (error) => error?.code === 'P2002' || /23505|unique constraint/i.test(error?.message ?? '');
