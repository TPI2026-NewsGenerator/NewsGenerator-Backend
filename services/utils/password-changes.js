//
//  Author: Fabian Rostello
//  Date: 02.10.2026
//  File: password-changes.js
//  Description: When each account last changed its password: the sessions opened before are refused
//               (see authenticateToken in jwt.js), on every other device
//

"use strict"

// userId -> the second of its last change of password, 0 when never, null when the account is gone.
// Read once from the database, then known here: one server, and the change itself tells it
const known = new Map();

export const passwordChangedAt = async (userId) => {
    if (!known.has(userId)) {
        // the model is loaded when a session is first checked: jwt.js stays free of the database
        // for whoever only signs a token
        const {UserModel} = await import('../../models/user-model.js');
        known.set(userId, await UserModel.passwordChangedAt(userId));
    }
    return known.get(userId);
};

// at: the second of the change, the one written in the database
export const notePasswordChange = (userId, at) => known.set(userId, at);
