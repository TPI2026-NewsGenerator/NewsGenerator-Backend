//
//  Author: Fabian Rostello
//  Date: 09.11.2026
//  File: translation-completeness.mjs
//  Description: What a reader SEES of the saved briefings, text by text, against the language the reader reads: the title, the line
//               under it, the key points, the passages, the AI version, the titles of the other angles. A text is foreign when its
//               own letters say another language than the reader's (not when the label of its feed does: the audit of
//               scripts/briefing-audit.js reads the label, a Persian title of an English-labelled feed passed it)
//
//  node --env-file=.env bench/translation-completeness.mjs [days=14] [profileId]
//

import process from 'node:process';
import {prisma} from '../config/db.js';
import {ProfileModel} from '../models/profile-model.js';
import {readerLanguage, shownLanguage} from '../services/utils/language.js';

const days = Number(process.argv[2] ?? 14);
const onlyProfile = process.argv[3] ? Number(process.argv[3]) : null;

const short = (text, n = 60) => String(text ?? '').replace(/\s+/g, ' ').slice(0, n);
const ownLanguageOf = (text) => text.length < 12 ? null : shownLanguage(text);

const rows = await prisma.$queryRawUnsafe(
    `SELECT id, id_profile, created_at, items FROM briefings WHERE status = 'ready' AND created_at > now() - ($1 || ' days')::interval ORDER BY id`, String(days));
const profiles = new Map();
const total = {briefings: 0, cards: 0, briefingsWithProblem: 0};
const byField = new Map();
const examples = new Map();
const bump = (field, example) => {
    byField.set(field, (byField.get(field) ?? 0) + 1);
    if (!examples.has(field)) examples.set(field, []);
    if (examples.get(field).length < 6) examples.get(field).push(example);
};
for (const row of rows) {
    if (onlyProfile && row.id_profile !== onlyProfile) continue;
    if (!profiles.has(row.id_profile)) profiles.set(row.id_profile, row.id_profile ? await ProfileModel.get(row.id_profile) : null);
    const reader = readerLanguage(profiles.get(row.id_profile) ?? {});
    total.briefings++;
    let bad = false;
    for (const item of row.items ?? []) {
        total.cards++;
        const seen = [];
        const text = (field, value) => value && seen.push([field, String(value)]);
        // what the page shows first: the title of the card (translated when it has one)
        text('title', item.titleTranslation ?? item.title);
        text('why', item.why);
        // the passages: the translation when there is one, else the passages as published
        text('passages', item.translation ?? item.summary);
        text('points', item.pointsTranslation ?? item.points);
        text('digest', item.digestTranslation ?? item.digest);
        for (const [i, angle] of (item.angles ?? []).entries()) text('angle title', angle.titleTranslation ?? angle.title);
        text('ai points', Array.isArray(item.ai?.points) ? item.ai.points.join(' ') : null);
        text('ai summary', item.ai?.summary);
        for (const [field, value] of seen) {
            const first = value.split(/\n\n/)[0];
            const read = ownLanguageOf(value.length > 600 ? value.slice(0, 600) : value);
            if (read && read !== reader) {
                bad = true;
                bump(field, `#${row.id} [${read}] ${short(item.titleTranslation ?? item.title, 40)} | ${short(value, 50)}`);
            }
        }
    }
    if (bad) total.briefingsWithProblem++;
}
console.log(JSON.stringify(total));
console.log([...byField].map(([field, count]) => `${field}: ${count}`).join('\n'));
for (const [field, list] of examples) console.log(`\n${field}\n  ${list.join('\n  ')}`);
process.exit(0);
