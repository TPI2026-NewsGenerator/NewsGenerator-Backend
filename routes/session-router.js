//
//  Author: Fabian Rostello
//  Date: 02.10.2026
//  File: session-router.js
//  Description: The session of the signed in reader: who they are, and signing out. The page cannot
//               read its cookie (see jwt.js), it asks here
//

import express from 'express';
import {authenticateToken, endSession} from "../services/utils/jwt.js";
import {isAdmin} from "../services/utils/admin.js";
import {UserModel} from "../models/user-model.js";

const router = express.Router();

// admin: what the administrators can do is shown to them (see admin.js); it, the username and the email
// read now in the database, the token keeping the ones of when it was made: an email changed for the
// reader (by the administrator, 12.10.2026) shown at once
router.get('', authenticateToken, async (req, res) => {
    const {id, role} = req.user;
    try {
        const [account, admin] = await Promise.all([UserModel.email(id), isAdmin(id)]);
        const {username, email} = account ?? req.user;
        res.status(200).json({id, username, email, role, admin});
    } catch (error) {
        res.status(500).json({error: error.message ?? String(error)});
    }
});

router.delete('', (req, res) => {
    endSession(res);
    res.status(204).end();
});

export default router;
