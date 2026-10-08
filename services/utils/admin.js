//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: admin.js
//  Description: What only the administrators can do: send the briefing by e-mail, have several
//               profiles. The role is read in the database at each request, never in the token: a
//               reader made an administrator has it at once, without signing in again
//

"use strict"

import {UserModel} from '../../models/user-model.js';

export const ADMIN_ROLE = 'Admin';

export const isAdmin = async (userId) => await UserModel.roleName(userId) === ADMIN_ROLE;

// a route for the administrators only: 403 with what is refused for the others. After authenticateToken
export const adminOnly = (refused) => async (req, res, next) => {
    try {
        if (await isAdmin(req.user.id)) return next();
        res.status(403).json({error: refused});
    } catch (error) {
        res.status(500).json({error: error.message ?? String(error)});
    }
};
