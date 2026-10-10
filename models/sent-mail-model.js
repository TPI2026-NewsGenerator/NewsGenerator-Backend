//
//  Author: Fabian Rostello
//  Date: 10.10.2026
//  File: sent-mail-model.js
//  Description: The e-mails of a briefing as they were sent, read by the link they carry
//               (db/add_sent_mails.sql)
//

"use strict"

import {prisma} from '../config/db.js';

export const SentMailModel = {
    // the copy of an e-mail about to be sent: its id
    save: async ({token, userId, briefingId, subject, html}) => (await prisma.$queryRawUnsafe(`
        INSERT INTO sent_mails (token, id_user, id_briefing, subject, html) VALUES ($1, $2, $3, $4, $5)
        RETURNING id`, token, userId, briefingId, subject, html))[0].id,

    // {subject, html, created_at}, null when no e-mail has this token
    byToken: async (token) => (await prisma.$queryRawUnsafe(
        'SELECT subject, html, created_at FROM sent_mails WHERE token = $1', token))[0] ?? null,

    // the copy of an e-mail that could not be sent
    remove: async (id) => prisma.$executeRawUnsafe('DELETE FROM sent_mails WHERE id = $1', id),
};
