//
//  Author: Fabian Rostello
//  Date: 11.11.2026
//  File: events.mjs
//  Description: The events of real affairs, built as the product builds them, to measure the badges "Reported", "Official" and "Contested" where
//               the reader sees them: on the event, not on the article (the user, 11.11.2026: "juge la méthode"). The cards are the ones of the
//               last briefings; each is built with buildAffair (the AI judges the stories by their titles, the code makes the events and their
//               marks) and the events kept with the news they hold, to be read by judges.
//
//  node --env-file=.env bench/hedging/events.mjs build <how many cards> [offset]   affairs-built.json (appended: a card already built is skipped)
//

import process from 'node:process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {prisma} from '../../config/db.js';
import {ProfileModel} from '../../models/profile-model.js';
import {feedsOf} from '../../services/briefing-service.js';
import {buildAffair} from '../../services/utils/affair.js';
import {readerLanguage} from '../../services/utils/language.js';
import {newUsage} from '../../services/utils/ollama.js';

const DIR = 'bench/data/hedging';
const FILE = `${DIR}/affairs-built.json`;
const CARDS_AT_ONCE = 2;

const seeded = (seed) => () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const cardsOfLastBriefings = async () => {
    const rows = await prisma.$queryRawUnsafe(`
        SELECT DISTINCT ON ((i.item->>'storyId')::int) b.id_profile, (i.item->>'storyId')::int AS story, i.item->>'title' AS title
        FROM briefings b, jsonb_array_elements(b.items) AS i(item)
        WHERE b.status = 'ready' AND b.id_profile IS NOT NULL AND b.created_at > now() - interval '8 days' AND i.item->>'storyId' IS NOT NULL
        ORDER BY (i.item->>'storyId')::int, b.id DESC`);
    const random = seeded(1111);
    return rows.map(row => ({...row, k: random()})).sort((a, b) => a.k - b.k);
};

const build = async (count, offset) => {
    mkdirSync(DIR, {recursive: true});
    const done = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : [];
    const known = new Set(done.map(one => one.storyId));
    const cards = (await cardsOfLastBriefings()).slice(offset, offset + count).filter(card => !known.has(card.story));
    console.log(`${cards.length} cards to build`);
    const profiles = new Map();
    const usage = newUsage();
    let next = 0;
    const worker = async () => {
        while (next < cards.length) {
            const card = cards[next++];
            const started = Date.now();
            try {
                if (!profiles.has(card.id_profile)) {
                    const profile = await ProfileModel.get(card.id_profile);
                    profiles.set(card.id_profile, {language: readerLanguage(profile), feedUrls: await feedsOf(card.id_profile)});
                }
                const {language, feedUrls} = profiles.get(card.id_profile);
                const affair = await buildAffair({storyId: card.story, title: card.title, language, feedUrls, usage});
                done.push({storyId: card.story, profile: card.id_profile, title: card.title, affair: affair.affair, affairTitle: affair.title ?? null,
                    pool: affair.pool ?? null, events: affair.events ?? []});
                console.log(`${card.story} ${affair.affair ? `AFFAIR ${affair.events.length} events` : 'no affair'} (${Math.round((Date.now() - started) / 1000)} s) ${card.title.slice(0, 60)}`);
            } catch (err) {
                console.error(`${card.story}: ${err.message}`);
            }
            writeFileSync(FILE, JSON.stringify(done));
        }
    };
    await Promise.all(Array.from({length: CARDS_AT_ONCE}, worker));
    console.log(`tokens ${JSON.stringify(usage)}; ${done.filter(one => one.affair).length} affairs, ${done.filter(one => one.affair).reduce((sum, one) => sum + one.events.length, 0)} events in ${FILE}`);
};

try {
    if (process.argv[2] === 'build') await build(Number(process.argv[3] ?? 4), Number(process.argv[4] ?? 0));
    else console.log('node --env-file=.env bench/hedging/events.mjs build <cards> [offset]');
} finally {
    await prisma.$disconnect();
}
