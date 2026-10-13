//
//  Author: Fabian Rostello
//  Date: 10.10.2026
//  File: sent-mail-model.js
//  Description: The e-mails of a briefing as they were sent, read by the link they carry
//               (db/add_sent_mails.sql). Only the ones sent before 13.10.2026 carry one
//

"use strict"

import {prisma} from '../config/db.js';

export const SentMailModel = {
    // {subject, html, created_at}, null when no e-mail has this token
    byToken: async (token) => (await prisma.$queryRawUnsafe(
        'SELECT subject, html, created_at FROM sent_mails WHERE token = $1', token))[0] ?? null,

};
