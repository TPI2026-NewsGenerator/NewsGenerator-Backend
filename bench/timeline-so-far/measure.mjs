//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: measure.mjs
//  Description: The "story so far" of the cards: how many of its lines are stories of another country than the card's (a card of the FKF of
//               Kenya whose lines were the NFF of Nigeria, a friend of the user, 12.11.2026), by the countries of the items their news name.
//               Takes the cards of the briefings of the last days with the stories of the thread of each created before it, tells for each line
//               the countries of the card and of the line, and prints what a rule "cut a line whose countries share none with the card's"
//               would cut, to be read by hand. Reads, writes nothing
//
//  node bench/timeline-so-far/measure.mjs [days = 5] [examples = 40]
//

import 'dotenv/config';
import {prisma} from '../../config/db.js';

const days = Number(process.argv[2] ?? 5);
const wanted = Number(process.argv[3] ?? 40);

const briefings = await prisma.$queryRawUnsafe(
    `SELECT id, created_at, items FROM briefings WHERE status = 'ready' AND created_at > now() - ($1 || ' days')::interval ORDER BY id`, String(days));

// the countries of the items the news of each story name, with how many news name each: {story: Map(country -> news)}
const countriesOf = async (storyIds) => {
    const rows = await prisma.$queryRawUnsafe(`
        SELECT a.id_story AS story, ic.country, count(DISTINCT a.id)::int AS news
        FROM articles a
        JOIN article_mentions am ON am.id_article = a.id
        JOIN mentions m ON m.id = am.id_mention
        JOIN item_countries ic ON ic.qid = m.qid
        WHERE a.id_story = ANY($1::int[]) AND ic.country IS NOT NULL AND NOT ic.international AND ic.media IS NOT TRUE
          -- a person of an international body (Infantino of FIFA) is of no country the news is about
          AND NOT EXISTS (SELECT 1 FROM item_countries body WHERE body.qid = ANY(ic.bodies) AND body.international)
        GROUP BY a.id_story, ic.country`, storyIds);
    const answer = new Map();
    for (const row of rows) {
        if (!answer.has(row.story)) answer.set(row.story, new Map());
        answer.get(row.story).set(row.country, row.news);
    }
    return answer;
};

const DOMINANT = Number(process.env.DOMINANT ?? 0.75);
let cards = 0;
let lines = 0;
let unknown = 0;
let notDominant = 0;
let cut = 0;
let cardsWithCut = 0;
const printed = [];
const seen = new Set();
for (const row of briefings) {
    const stories = [...new Set((row.items ?? []).map(item => item.storyId))];
    if (stories.length === 0) continue;
    const earlier = await prisma.$queryRawUnsafe(`
        SELECT s.id AS card, o.id, o.created_at, first.title
        FROM stories s
        JOIN stories o ON o.id_thread = s.id_thread AND o.id <> s.id AND o.created_at < s.created_at
        CROSS JOIN LATERAL (SELECT a.title FROM articles a WHERE a.id_story = o.id ORDER BY COALESCE(a.published_at, a.created_at) LIMIT 1) AS first
        WHERE s.id = ANY($1::int[]) AND s.id_thread IS NOT NULL
        ORDER BY o.created_at`, stories);
    const countries = await countriesOf([...new Set([...stories, ...earlier.map(line => line.id)])]);
    for (const item of row.items ?? []) {
        const mine = earlier.filter(line => line.card === item.storyId);
        if (mine.length === 0 || seen.has(item.storyId)) continue;
        seen.add(item.storyId);
        cards++;
        const own = countries.get(item.storyId) ?? new Map();
        let cardCut = 0;
        for (const line of mine) {
            lines++;
            const theirs = countries.get(line.id) ?? new Map();
            if (own.size === 0 || theirs.size === 0) { unknown++; continue; }
            if ([...theirs.keys()].some(country => own.has(country))) continue;
            // a card of several countries (a tournament, a World Cup of three hosts) has no country another one is the stranger of
            const total = [...own.values()].reduce((sum, news) => sum + news, 0);
            if (Math.max(...own.values()) / total < DOMINANT) { notDominant++; continue; }
            cut++;
            cardCut++;
            if (printed.length < wanted) printed.push(`  card "${item.title.slice(0, 70)}" ${JSON.stringify([...own])}\n    line "${line.title.slice(0, 80)}" ${JSON.stringify([...theirs])}`);
        }
        if (cardCut > 0) cardsWithCut++;
    }
}
console.log(`${cards} cards with a thread, ${lines} lines of "the story so far"`);
console.log(`lines the rule could not judge (the card or the line names no country): ${unknown}`);
console.log(`lines of another country than a card of several countries (none of them dominant, ${DOMINANT}): ${notDominant}, kept`);
console.log(`lines it would cut (no country of the line is one of the card's): ${cut}, on ${cardsWithCut} cards`);
console.log(printed.join('\n'));
await prisma.$disconnect();
