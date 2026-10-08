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

const router = express.Router();

// admin: what the administrators can do is shown to them (see admin.js), read now in the database
router.get('', authenticateToken, async (req, res) => {
    const {id, username, email, role} = req.user;
    try {
        res.status(200).json({id, username, email, role, admin: await isAdmin(id)});
    } catch (error) {
        res.status(500).json({error: error.message ?? String(error)});
    }
});

router.delete('', (req, res) => {
    endSession(res);
    res.status(204).end();
});

export default router;
