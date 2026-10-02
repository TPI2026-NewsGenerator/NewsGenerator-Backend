//
//  Author: Fabian Rostello
//  Date: 02.10.2026
//  File: session-router.js
//  Description: The session of the signed in reader: who they are, and signing out. The page cannot
//               read its cookie (see jwt.js), it asks here
//

import express from 'express';
import {authenticateToken, endSession} from "../services/utils/jwt.js";

const router = express.Router();

router.get('', authenticateToken, (req, res) => {
    const {id, username, email, role} = req.user;
    res.status(200).json({id, username, email, role});
});

router.delete('', (req, res) => {
    endSession(res);
    res.status(204).end();
});

export default router;
