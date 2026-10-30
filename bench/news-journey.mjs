// The way of one news through the briefing, for docs/a-to-z/parcours-d-une-nouvelle: a briefing of a
// profile written live as the server writes it, its analysis included, and never saved: the writes of
// the briefing (its step, its watched news, its analysis) are caught here, never sent to the database.
// Every call to the AI is recorded (its model, prompt, answer and seconds), with the stories ranked by
// the vectors and the cards as the reader gets them. The caches every briefing fills stay filled (the
// real address of a news of Google News, the items of Wikidata of an official source).
//   node --env-file=.env bench/news-journey.mjs <out.json> [profileId=7] [hours=48]
import {writeFileSync} from 'node:fs';
import pg from 'pg';

const [out, profileArg, hoursArg] = process.argv.slice(2);
const profileId = Number(profileArg ?? 7);
const hours = Number(hoursArg ?? 48);

// every call to the AI, recorded before the client of Ollama takes fetch (at its import)
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
    const target = String(url?.url ?? url);
    if (!/ollama\.com|generativelanguage/.test(target)) return realFetch(url, options);
    const started = Date.now();
    let request = null;
    try { request = JSON.parse(options.body); } catch { /* not JSON */ }
    const record = {at: started, model: request?.model ?? (target.includes('generativelanguage') ? 'gemini' : null),
        think: request?.think ?? null, prompt: request?.messages?.map(m => m.content).join('\n---\n') ?? null};
    calls.push(record);
    try {
        const response = await realFetch(url, options);
        record.answer = await response.clone().text();
        record.status = response.status;
        return response;
    } finally {
        record.seconds = (Date.now() - started) / 1000;
    }
};

const {write, feedsOf} = await import('../services/briefing-service.js');
const {BriefingModel} = await import('../models/briefing-model.js');
const {ProfileModel} = await import('../models/profile-model.js');
const {StoryModel} = await import('../models/story-model.js');

// the writes of a briefing caught: its steps timed, its analysis kept here
const FAKE_ID = -1;
const steps = [];
let analysis = null;
let analysisDone;
const analysisEnded = new Promise(resolve => { analysisDone = resolve; });
BriefingModel.step = async (id, name) => { steps.push({name, at: Date.now()}); };
BriefingModel.watched = async () => {};
BriefingModel.analysis = async (id, value) => {
    analysis = value;
    if (value?.status === 'ready' || value?.status === 'failed') analysisDone();
};
// the stories ranked by the vectors, as the briefing gets them
let pool = null;
const rank = StoryModel.rank;
StoryModel.rank = async (args) => {
    const started = Date.now();
    pool = await rank(args);
    pool.seconds = (Date.now() - started) / 1000;
    return pool;
};

const profile = await ProfileModel.get(profileId);
const interests = await ProfileModel.briefingInterests(profileId);
const feedUrls = await feedsOf(profileId);
const since = new Date(Date.now() - hours * 3600e3);

// how many news and stories of the sources of the profile are scored
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const {rows: [scope]} = await db.query(`
    SELECT count(DISTINCT a.link)::int AS news, count(DISTINCT a.id_story)::int AS stories, count(DISTINCT a.lang)::int AS languages,
           count(DISTINCT a.link) FILTER (WHERE a.lang = $3)::int AS in_reader_language
    FROM articles a JOIN feeds f ON f.id = a.id_feed
    WHERE f.url = ANY($1) AND a.embedded_at IS NOT NULL AND a.id_story IS NOT NULL
      AND COALESCE(a.published_at, a.created_at) >= $2`, [feedUrls, since, profile.languages?.[0] ?? 'en']);
await db.end();

// the briefing, live, then its analysis (never awaited by the briefing)
const log = console.log;
const lines = [];
console.log = (...args) => lines.push(args.join(' '));
console.error = (...args) => lines.push('ERROR ' + args.join(' '));
const started = Date.now();
const items = await write(FAKE_ID, profileId, hours);
const writeSeconds = (Date.now() - started) / 1000;
const analysisStarted = Date.now();
await Promise.race([analysisEnded, new Promise(resolve => setTimeout(resolve, 20 * 60e3))]);
const analysisSeconds = (Date.now() - analysisStarted) / 1000;
console.log = log;

const stepSeconds = steps.map((step, i) => ({name: step.name,
    seconds: ((steps[i + 1]?.at ?? started + writeSeconds * 1000) - step.at) / 1000}));
writeFileSync(out, JSON.stringify({
    profileId, hours, measuredAt: new Date().toISOString(),
    profile: profile.text, languages: profile.languages,
    interests: interests.map(i => ({id: i.id, text: i.text, weight: i.weight, project: i.project ?? null})),
    scope, feeds: feedUrls.length, writeSeconds, stepSeconds, analysisSeconds, log: lines,
    pool: pool?.length ?? null, rankSeconds: pool?.seconds ?? null,
    poolTop: (pool ?? []).slice(0, 200).map((row, i) => ({rank: i + 1, storyId: row.id_story, articleId: row.id_article, interestId: row.id_interest, score: Number(row.score)})),
    calls,
    cards: items,
    analysis,
}, null, 1));
log(`${items.length} cards in ${writeSeconds} s, ${calls.length} AI calls; ranked ${pool?.length} in ${pool?.seconds} s; analysis ${analysis?.status} in ${analysisSeconds} s`);
log(stepSeconds.map(s => `${s.name} ${s.seconds} s`).join(', '));
items.forEach(item => log(`${item.storyId} [${item.language}] ${item.title} (${item.articles?.length} articles)${analysis?.cards?.[item.storyId] ? ' +analysis' : ''}${item.ai ? ' +ai' : ''}${item.official?.length ? ' +official' : ''}`));
process.exit(0);
