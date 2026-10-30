// A local API answering the profile page with the data of a user (env USER_ID) as read now, and its
// discovery shown running: to reproduce in a browser what the page does while sources are looked for,
// without a session. Reads only; nothing is changed. Port 3999
import fs from 'node:fs';
import express from 'express';
import {prisma} from '../config/db.js';
import {ProfileService} from '../services/profile-service.js';
import {FeedService} from '../services/feed-service.js';
import {FeedModel} from '../models/feed-model.js';
import {RecommendationService} from '../services/recommendation-service.js';
import {BriefingService} from '../services/briefing-service.js';
import {isFlood} from '../services/utils/feed-limits.js';

const userId = Number(process.env.USER_ID);
const app = express();
app.use(express.json());
let polls = 0;
// the sources found the page removes, in memory only: the database is never written
const removed = new Map();
// the language changed by the page, in memory only: no AI, nothing written
let language = null;

// the first profile of the user, the one the page reads
const firstProfile = async () => ProfileService.get(userId, (await ProfileService.list(userId))[0]?.id);
const profile = async () => {
    const answer = await firstProfile();
    // STATUS=done: the page without a discovery running
    answer.profile.discovery.status = process.env.STATUS ?? 'running';
    // PHASE=press: the sources of Google News added, the press still looked for
    answer.profile.discovery.phase = process.env.STATUS === 'done' ? null : process.env.PHASE ?? 'google';
    answer.sources = answer.sources.filter(source => !removed.has(String(source.id)));
    answer.removedSources = [...answer.removedSources, ...[...removed.values()].map(source => ({
        key: `mock${source.id}`, site: source.site, url: source.url, category: source.category, language: source.language}))];
    if (language) answer.profile.language = language;
    return answer;
};
app.put('/api/profile', async (req, res) => {
    console.log(`PUT /profile language ${req.body?.language}, text ${req.body?.text?.length} chars`);
    language = req.body?.language ?? language;
    setTimeout(async () => res.json(await profile()), 1500);
});
app.delete('/api/profile/sources/:id', async (req, res) => {
    const source = (await firstProfile()).sources.find(found => String(found.id) === req.params.id);
    if (!source) return res.status(404).json({error: 'This source was not found for your profile.'});
    removed.set(req.params.id, source);
    res.json(await profile());
});
app.post('/api/profile/removed-sources/restore', async (req, res) => {
    removed.delete(String(req.body?.key).replace(/^mock/, ''));
    res.json(await profile());
});
// ADMIN=1: the page of an admin (several profiles, "New profile")
app.get('/api/session', (req, res) => res.json({id: userId, username, email: 'reader@example.test', role: 'User', admin: process.env.ADMIN === '1'}));
app.get('/api/profile/options', (req, res) => res.json({languages: FeedService.languages(), signup: process.env.SIGNUP_OPEN === '1'}));
app.get('/api/profile/profiles', async (req, res) => res.json({profiles: await ProfileService.list(userId)}));
app.get('/api/profile', async (req, res) => {
    console.log(`GET /profile ${++polls}`);
    res.json(await profile());
});
app.post('/api/profile/rediscover', async (req, res) => res.json(await profile()));
app.get('/api/feeds', async (req, res) => res.json({feeds: (await FeedModel.listUserFeeds(userId)).map(feed => ({
    id: feed.id, url: feed.url, site: feed.site, category: feed.category, origin: feed.origin,
    trusted: feed.trusted ?? false, shared: feed.shared ?? false, error: feed.last_error ?? null,
    newsPerDay: feed.news_per_day ?? 0, flood: isFlood(feed.news_per_day),
}))}));
app.get('/api/feeds/recommended', async (req, res) => res.json({sources: await RecommendationService.list(userId)}));
// the last briefing as stored, read only; LEAD=1 gives its cards the article of their passages, as the new ones
app.get('/api/briefing', async (req, res) => {
    const briefing = await BriefingService.latest(userId);
    if (briefing && process.env.LEAD) briefing.items = briefing.items.map(item => ({...item, lead: item.articles.at(-1)}));
    // CONTESTED=1: the denials bench/contested-profile.mjs found for the cards of this reader
    if (briefing && process.env.CONTESTED) {
        const found = new Map(JSON.parse(fs.readFileSync(new URL(`./data/contested-profile-${userId}.json`, import.meta.url), 'utf8'))
            .filter(card => card.contested?.length).map(card => [card.storyId, card.contested]));
        // the cards of the older briefings it found some for first, then the last briefing's
        const rows = await prisma.$queryRawUnsafe(`SELECT items FROM briefings WHERE id_user = $1 AND status = 'ready'
            AND created_at > now() - interval '21 days' ORDER BY created_at DESC`, userId);
        const seen = new Set();
        briefing.items = [...rows.flatMap(row => row.items).filter(item => found.has(item.storyId)), ...briefing.items]
            .filter(item => !seen.has(item.storyId) && seen.add(item.storyId))
            .map(item => ({...item, contested: found.get(item.storyId) ?? []}));
    }
    res.json({briefing});
});
app.get('/api/news/categories', (req, res) => res.json({categories: FeedService.categories(req.query.language)}));
// the settings: nothing changed, the answer of a change accepted (a password 'wrong' is refused)
let username = 'reader';
app.put('/api/account/username', (req, res) => req.body.password === 'wrong'
    ? res.status(401).json({error: 'Your current password is not this one.'})
    : res.json({id: userId, username: (username = req.body.username), email: 'reader@example.test', role: 2}));
app.put('/api/account/password', (req, res) => req.body.password === 'wrong'
    ? res.status(401).json({error: 'Your current password is not this one.'})
    : res.json({id: userId, username, email: 'reader@example.test', role: 2}));
app.use((req, res) => {
    console.log(`not mocked: ${req.method} ${req.path}`);
    res.status(404).json({error: 'not mocked'});
});
app.listen(3999, '127.0.0.1', () => console.log('mock API on 3999'));
process.on('SIGINT', async () => {
    await prisma.$disconnect();
    process.exit(0);
});
