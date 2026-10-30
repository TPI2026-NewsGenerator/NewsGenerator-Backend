// Read only: which other angles each rule of the places would show (see placeAngles), on the cards of
// the last briefings of three readers, their candidates built and judged as the briefing does (see
// angleCardsOf), RUNS times. The angles any rule shows are labeled by hand in
// bench/data/angles-places-labels.json (G another angle of the affair, S the same fact, T the same
// theme, W another subject), then counted:
//   node --env-file=.env bench/angles-places.mjs            judges, writes bench/data/angles-places.json
//   REJUDGE=1 node --env-file=.env bench/angles-places.mjs  judges again the candidates of that file
//                                                           (another prompt), writes it back
//   SCORE=1 node --env-file=.env bench/angles-places.mjs    counts with the labels
import fs from 'node:fs';
import {angleCardsOf, feedsOf} from '../services/briefing-service.js';
import {otherAnglesOf, placeAngles} from '../services/utils/other-angles.js';
import {StoryModel} from '../models/story-model.js';
import {newUsage} from '../services/utils/ollama.js';
import {prisma} from '../config/db.js';

const BRIEFINGS = (process.env.BRIEFINGS ?? '92,91,90').split(',').map(Number);
const RUNS = Number(process.env.RUNS ?? 2);
const DATA = new URL(process.env.DATA ?? './data/angles-places.json', import.meta.url);
const LABELS = new URL(process.env.LABELS ?? './data/angles-places-labels.json', import.meta.url);

// each rule: the angles of each card in the order of the AI's list -> the ones shown, a story shown
// below the first card only (as anglesOf)
const firstOnes = (max) => (angles) => angles.slice(0, max);
const RULES = {
    'first 3 (before)': firstOnes(3),
    '3, one place by names': (angles) => placeAngles(angles, 3),
    'first 5': firstOnes(5),
    '5, one place by names': (angles) => placeAngles(angles, 5),
};
const shownBy = (rule, cards) => {
    const placed = new Set();
    return cards.map(card => {
        const shown = rule(card.angles.filter(other => !placed.has(other.storyId)));
        shown.forEach(other => placed.add(other.storyId));
        return {...card, shown};
    });
};

// the cards of a briefing judged RUNS times: [{storyId: [angle storyIds]}]
const judgeRuns = async (cards) => {
    const runs = [];
    for (let run = 0; run < RUNS; run++) {
        const usage = newUsage();
        const judged = await otherAnglesOf(cards, usage);
        runs.push(Object.fromEntries(cards.map(card => [card.id, (judged.get(card.id) ?? []).map(other => other.storyId)])));
        console.log(`  run ${run + 1}: ${JSON.stringify(usage)}`);
    }
    return runs;
};

if (process.env.REJUDGE === '1') {
    const briefings = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    for (const briefing of briefings) {
        console.log(`briefing ${briefing.id}`);
        briefing.runs = await judgeRuns(briefing.cards);
    }
    fs.writeFileSync(DATA, JSON.stringify(briefings, null, 1));
}
if (process.env.SCORE !== '1' && process.env.REJUDGE !== '1') {
    const briefings = [];
    for (const id of BRIEFINGS) {
        const [briefing] = await prisma.$queryRawUnsafe(`SELECT id, id_profile, hours, created_at, items FROM briefings WHERE id = $1`, id);
        const feedUrls = await feedsOf(briefing.id_profile);
        const since = new Date(briefing.created_at.getTime() - briefing.hours * 3600e3);
        const items = briefing.items.filter(item => item.storyId > 0);
        const stories = [];
        for (const item of items) {
            const members = await StoryModel.storyArticles({storyIds: [item.storyId, ...(item.mergedStoryIds ?? [])], feedUrls, since});
            stories.push({storyId: item.storyId, mergedStoryIds: item.mergedStoryIds ?? [], members, best: members[0]});
        }
        const t = Date.now();
        const cards = await angleCardsOf(stories, items.map(item => item.title), {feedUrls, hours: briefing.hours});
        console.log(`briefing ${id}: ${cards.length} cards, ${cards.reduce((n, card) => n + card.others.length, 0)} candidates `
            + `(${cards.reduce((n, card) => n + card.others.filter(o => o.named).length, 0)} by names), ${Date.now() - t} ms`);
        const runs = await judgeRuns(cards);
        briefings.push({id, profile: briefing.id_profile, cards: cards.map(card => ({
            id: card.id, title: card.title, titles: card.titles, at: card.at, otherCards: card.otherCards ?? [],
            others: card.others.map(other => ({storyId: other.storyId, title: other.title, at: other.at, named: other.named})),
        })), runs});
    }
    fs.writeFileSync(DATA, JSON.stringify(briefings, null, 1));
}
if (process.env.SCORE !== '1') {
    const briefings = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    // the angles to label: every one a rule shows in a run
    const labels = fs.existsSync(LABELS) ? JSON.parse(fs.readFileSync(LABELS, 'utf8')) : {};
    for (const briefing of briefings) {
        for (const card of briefing.cards) {
            const ids = new Set(briefing.runs.flatMap(run => run[card.id] ?? []));
            const todo = card.others.filter(other => ids.has(other.storyId) && !labels[`${card.id}:${other.storyId}`]);
            if (todo.length === 0) continue;
            console.log(`\n#${card.id} [${card.title}]`);
            for (const other of todo) console.log(`  ${card.id}:${other.storyId} ${other.named ? 'NAMED' : 'close'} ${String(other.at).slice(0, 10)} ${other.title}`);
        }
    }
} else {
    const briefings = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    const labels = JSON.parse(fs.readFileSync(LABELS, 'utf8'));
    for (const [name, rule] of Object.entries(RULES)) {
        const line = [];
        for (let run = 0; run < briefings[0].runs.length; run++) {
            const counts = {G: 0, S: 0, T: 0, W: 0}, named = {G: 0, other: 0};
            let cards = 0, withG = 0;
            for (const briefing of briefings) {
                const judged = briefing.cards.map(card => ({id: card.id,
                    angles: (briefing.runs[run][card.id] ?? []).map(id => card.others.find(other => other.storyId === id))}));
                for (const card of shownBy(rule, judged)) {
                    cards++;
                    const kinds = card.shown.map(other => labels[`${card.id}:${other.storyId}`] ?? '?');
                    kinds.forEach((kind, i) => {
                        counts[kind] = (counts[kind] ?? 0) + 1;
                        if (card.shown[i].named) named[kind === 'G' ? 'G' : 'other']++;
                    });
                    if (kinds.includes('G')) withG++;
                }
            }
            const shown = Object.values(counts).reduce((a, b) => a + b, 0);
            line.push(`run ${run + 1}: ${shown} shown ${JSON.stringify(counts)} right ${(100 * counts.G / (shown || 1)).toFixed(0)}%, `
                + `cards with a right one ${withG}/${cards}, by names ${named.G} right ${named.other} wrong`);
        }
        console.log(`${name}\n  ${line.join('\n  ')}`);
    }
}
await prisma.$disconnect();
process.exit(0);
