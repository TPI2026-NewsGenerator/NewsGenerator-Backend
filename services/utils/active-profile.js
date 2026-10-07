//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: active-profile.js
//  Description: The profile a request is about, among the profiles of its user
//

"use strict"

import {ProfileModel} from '../../models/profile-model.js';

// The client sends the profile chosen in the header X-Profile; it is used only when it is one of the
// user of the token. Without it, or with one that is not (any more) theirs, the first profile of the
// user. req.profileId: null when the user has no profile yet. After authenticateToken
export const activeProfile = async (req, res, next) => {
    try {
        const ids = await ProfileModel.idsOf(req.user.id);
        const asked = Number.parseInt(req.get('x-profile') ?? '', 10);
        req.profileId = ids.includes(asked) ? asked : ids[0] ?? null;
        next();
    } catch (error) {
        res.status(500).json({error: error.message ?? String(error)});
    }
};

// a source belongs to a profile: none is added before the first one is written. After activeProfile
export const needsProfile = (req, res, next) => req.profileId === null
    ? res.status(400).json({error: 'Write your profile first: your sources belong to it.'})
    : next();
