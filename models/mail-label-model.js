//
//  Author: Fabian Rostello
//  Date: 02.11.2026
//  File: mail-label-model.js
//  Description: The words of the e-mail of a briefing translated for a language, kept from one session of the
//               server to the next (db/add_mail_labels.sql)
//

"use strict"

import {prisma} from '../config/db.js';

export const MailLabelModel = {
    // Map English text -> its translation in this language (a code: 'fr')
    of: async (language) => new Map((await prisma.$queryRawUnsafe(
        'SELECT source, translation FROM mail_labels WHERE language = $1', language)).map(row => [row.source, row.translation])),

    // [{source, translation}] kept for this language; one already there is never replaced (a translation
    // corrected by hand stays)
    save: async (language, rows) => rows.length === 0 ? 0 : prisma.$executeRawUnsafe(`
        INSERT INTO mail_labels (language, source, translation)
        SELECT $1, r.source, r.translation FROM jsonb_to_recordset($2::jsonb) AS r(source text, translation text)
        ON CONFLICT (language, source) DO NOTHING`, language, JSON.stringify(rows)),
};
