//
//  Author: Fabian Rostello
//  Date: 04.11.2026
//  File: affair-view.js
//  Description: The affair of a card as the reader's page shows it: its events in time order and how widely the
//               media talked of it. Writes nothing
//
//  node scripts/affair-view.js <storyId> [profileId] [--close=80] [--max=160] [--trace=file.json]
//  (the profile of the last briefing holding the story; --trace writes every story of the pool with its verdict)
//

import 'dotenv/config';
import process from 'node:process';
import {writeFileSync} from 'node:fs';
import {prisma} from '../config/db.js';
import {ProfileModel} from '../models/profile-model.js';
import {feedsOf} from '../services/briefing-service.js';
import {buildAffair} from '../services/utils/affair.js';
import {readerLanguage} from '../services/utils/language.js';
import {newUsage} from '../services/utils/ollama.js';

const flags = Object.fromEntries(process.argv.filter(arg => arg.startsWith('--')).map(arg => arg.slice(2).split('=')));
const args = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const storyId = Number(args[0]);
if (!Number.isInteger(storyId)) {
    console.error('node scripts/affair-view.js <storyId> [profileId] [--close=80] [--max=160] [--trace=file.json]');
    process.exit(1);
}
let profileId = Number(args[1]) || null;
let title = null;
if (!profileId) {
    const [card] = await prisma.$queryRawUnsafe(`
        SELECT b.id_profile, i.item->>'title' AS title
        FROM briefings b, jsonb_array_elements(b.items) AS i(item)
        WHERE b.status = 'ready' AND b.id_profile IS NOT NULL AND (i.item->>'storyId')::int = $1
        ORDER BY b.id DESC LIMIT 1`, storyId);
    profileId = card?.id_profile ?? null;
    title = card?.title ?? null;
}
if (!profileId) {
    console.error('No profile: give one.');
    process.exit(1);
}
const profile = await ProfileModel.get(profileId);
const language = readerLanguage(profile);
if (!title) {
    const [first] = await prisma.$queryRawUnsafe('SELECT title FROM articles WHERE id_story = $1 ORDER BY COALESCE(published_at, created_at) LIMIT 1', storyId);
    title = first?.title ?? `story ${storyId}`;
}

const usage = newUsage();
const started = Date.now();
const feedUrls = await feedsOf(profileId);
const affair = await buildAffair({storyId, title, language, feedUrls, usage, trace: Boolean(flags.trace),
    ...(flags.close ? {closePerStory: Number(flags.close)} : {}), ...(flags.max ? {maxPool: Number(flags.max)} : {})});
if (flags.trace && affair.trace) writeFileSync(flags.trace, JSON.stringify(affair.trace, null, 1));
console.log(`${((Date.now() - started) / 1000).toFixed(1)} s, tokens ${JSON.stringify(usage)}, reader ${language}`);
console.log(`Card: ${title}`);
if (!affair.affair) {
    console.log('NOT an affair', JSON.stringify(affair.pool ?? {}));
} else {
    console.log(`AFFAIR: ${affair.title}${affair.written ? '' : `  (the card’s own title; the AI proposed "${affair.proposed}")`}`);
    console.log(`  covers: ${affair.about}`);
    console.log(`  pool ${JSON.stringify(affair.pool)}`);
    for (const event of affair.events) {
        const marks = [event.reported ? `reported(${event.reported})` : '', event.official ? 'OFFICIAL' : '', event.denial ? 'DENIAL' : ''].filter(Boolean).join(' ');
        console.log(`${event.at.slice(5, 16)} ${event.kind === 'key' ? 'KEY  ' : '     '} m${String(event.media.length).padStart(3)} L${event.languages.length} ${event.storyIds.length > 1 ? `x${event.storyIds.length}` : '  '} ${marks} | ${(event.titleTranslation ?? event.title).slice(0, 100)}`);
    }
    const foreign = affair.events.filter(event => event.language !== language);
    const untranslated = foreign.filter(event => !event.titleTranslation);
    console.log(`TRANSLATION: ${foreign.length} events in another language than ${language}, ${untranslated.length} without a translation`);
    const byLanguage = {};
    for (const event of untranslated) byLanguage[event.language] = (byLanguage[event.language] ?? 0) + 1;
    if (untranslated.length > 0) console.log('  not translated, by language:', JSON.stringify(byLanguage), '| e.g.', untranslated.slice(0, 3).map(event => `[${event.language}] ${event.title.slice(0, 50)}`).join(' | '));
    const c = affair.coverage;
    console.log(`COVERAGE: ${c.media} media, ${c.news} news, first ${c.first?.medium} (${c.first?.at?.slice(0, 16)}), peak ${c.peak?.day} (${c.peak?.media} media)`);
    console.log(`  languages: ${c.languages.slice(0, 8).map(l => `${l.language} ${l.media}`).join(', ')}`);
    console.log(`  days: ${c.days.map(d => `${d.day.slice(5)}:${d.media}`).join(' ')}`);
}
await prisma.$disconnect();
