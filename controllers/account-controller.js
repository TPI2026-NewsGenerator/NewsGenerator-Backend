//
//  Author: Fabian Rostello
//  Date: 02.10.2026
//  File: account-controller.js
//  Description: Controller for the settings of an account
//

"use strict"

import {AccountService} from "../services/account-service.js";
import {startSession} from "../services/utils/jwt.js";

// the session starts again with the account as it is now, and the page is told who is signed in
const respond = async (res, serviceFn) => {
    try {
        const {user, token} = await serviceFn();
        startSession(res, token);
        return res.status(200).json(user);
    } catch (error) {
        const status = error.status || 500;
        if (status >= 500) console.error(`Account: ${error.message ?? error}`);
        return res.status(status).json({error: status >= 500 ? 'Your account could not be changed right now.' : error.message});
    }
};

export const AccountController = {
    // the account is always the one of the session, never one named in the request
    rename: (req, res) => {
        const {username, password} = req.body ?? {};
        return respond(res, () => AccountService.rename(req.user.id, {username, password}));
    },

    changeEmail: (req, res) => {
        const {email, password} = req.body ?? {};
        return respond(res, () => AccountService.changeEmail(req.user.id, {email, password}));
    },

    changePassword: (req, res) => {
        const {password, newPassword} = req.body ?? {};
        return respond(res, () => AccountService.changePassword(req.user.id, {password, newPassword}));
    },
};
