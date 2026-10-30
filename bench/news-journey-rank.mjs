// The place of one story in the ranking of bench/news-journey.mjs, for docs/a-to-z/parcours-d-une-nouvelle:
// the ranked pool shared out between the interests (shareOut, as the briefing does), the place of the
// story, the stories just before and after it in its interest, and the scores of the first and the last
// kept. Read only.
//   node --env-file=.env bench/news-journey-rank.mjs <journey.json> <storyId>
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {shareOut} from '../services/utils/profile-ai.js';

const [file, storyArg] = process.argv.slice(2);
const storyId = Number(storyArg);
const journey = JSON.parse(readFileSync(file, 'utf8'));
const interests = journey.interests;
const pool = journey.poolTop.map(row => ({...row, id_story: row.storyId, id_interest: row.interestId}));
const ranked = shareOut(pool, 150, row => row.id_interest, interests);
const at = ranked.findIndex(row => row.id_story === storyId);
const mine = ranked.filter(row => row.id_interest === ranked[at].id_interest);
const inInterest = mine.findIndex(row => row.id_story === storyId);
const near = [mine[inInterest - 1], mine[inInterest + 1]].filter(Boolean);

const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const titles = new Map((await db.query(`SELECT id, title FROM articles WHERE id = ANY($1::int[])`,
    [near.map(row => row.articleId)])).rows.map(row => [row.id, row.title]));
await db.end();

console.log(JSON.stringify({
    pool: journey.pool, shared: ranked.length, poolRank: pool.findIndex(row => row.storyId === storyId) + 1,
    sharedRank: at + 1, interestRank: inInterest + 1, perInterest: Object.fromEntries(interests.map(i => [i.id, ranked.filter(r => r.id_interest === i.id).length])),
    first: ranked[0].score, last: ranked.at(-1).score, score: ranked[at].score,
    before: near[0] && {score: near[0].score, title: titles.get(near[0].articleId)},
    after: near[1] && {score: near[1].score, title: titles.get(near[1].articleId)},
    tokens: journey.log.find(line => line.includes('tokens {')),
}, null, 1));
process.exit(0);
