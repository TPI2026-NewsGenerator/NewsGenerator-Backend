//
//  Author: Fabian Rostello
//  Date: 05.11.2026
//  File: repair-angle-titles.js
//  Description: The titles of the other angles of the briefings already written that are in another language than their label says (a
//               Czech or Persian paper in a feed declared English) translated into the language of their reader. The briefings
//               written since 5.11.2026 have them right (see translatedTitles); this brings the earlier ones up to date
//
//  node scripts/repair-angle-titles.js [--days=7]            shows what would change, writes nothing
//  node scripts/repair-angle-titles.js [--days=7] --write    writes it
//

import 'dotenv/config';
import process from 'node:process';
import {prisma} from '../config/db.js';
import {ProfileModel} from '../models/profile-model.js';
import {readerLanguage} from '../services/utils/language.js';
import {newUsage} from '../services/utils/ollama.js';
import {translatedTitles} from '../services/utils/title-translation.js';

const flags = Object.fromEntries(process.argv.filter(arg => arg.startsWith('--')).map(arg => arg.slice(2).split('=')));
const days = Number(flags.days ?? 7);
const write = 'write' in flags;

const briefings = await prisma.$queryRawUnsafe(
    `SELECT id, id_profile FROM briefings WHERE status = 'ready' AND id_profile IS NOT NULL AND created_at > now() - make_interval(days => $1::int) ORDER BY id`, days);
const usage = newUsage();
let changed = 0;
for (const {id, id_profile: profileId} of briefings) {
    const profile = await ProfileModel.get(profileId);
    const language = readerLanguage(profile ?? {});
    // the card is read again inside the transaction that writes it: a vote given meanwhile is not lost
    const done = await prisma.$transaction(async (tx) => {
        const [row] = await tx.$queryRawUnsafe(`SELECT items FROM briefings WHERE id = $1::int ${write ? 'FOR UPDATE' : ''}`, id);
        const angles = (row?.items ?? []).flatMap(item => item.angles ?? []).filter(angle => angle.title && !angle.titleTranslation);
        if (angles.length === 0) return 0;
        const answers = await translatedTitles(angles.map(angle => ({title: angle.title, label: angle.language})), language, usage);
        let count = 0;
        angles.forEach((angle, i) => {
            if (!answers[i].translation) return;
            console.log(`briefing ${id} (${language}): [${answers[i].language}] ${angle.title.slice(0, 70)} -> ${answers[i].translation.slice(0, 70)}`);
            angle.titleTranslation = answers[i].translation;
            angle.language = answers[i].language;
            count++;
        });
        if (write && count > 0) await tx.$executeRawUnsafe('UPDATE briefings SET items = $2::jsonb WHERE id = $1::int', id, JSON.stringify(row.items));
        return count;
    }, {timeout: 120000, maxWait: 20000});
    changed += done;
}
console.log(`${briefings.length} briefings of the last ${days} days, ${changed} titles ${write ? 'translated and saved' : 'to translate (nothing written: add --write)'}, tokens ${JSON.stringify(usage)}`);
await prisma.$disconnect();
