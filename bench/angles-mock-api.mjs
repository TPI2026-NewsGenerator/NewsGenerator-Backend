// A local API answering the briefing page with the last briefing of a profile (env PROFILE_ID, 7 by
// default), its other angles looked for now (see anglesOf), the news of the terms of WATCH: to see them in a browser without a session.
// Reads only; nothing is changed. Port 3999, with the client of the "client-mock" launch configuration
import express from 'express';
import {prisma} from '../config/db.js';
import {BriefingService, anglesOf, watchedNews} from '../services/briefing-service.js';
import {newUsage} from '../services/utils/ollama.js';

const profileId = Number(process.env.PROFILE_ID ?? 7);
const app = express();
let cached = null;

const briefing = async () => {
    if (cached) return cached;
    const latest = await BriefingService.latest(profileId);
    const feedUrls = (await prisma.$queryRawUnsafe('SELECT url FROM feeds')).map(row => row.url);
    const stories = latest.items.map(item => ({storyId: item.storyId, mergedStoryIds: item.mergedStoryIds,
        members: item.articles.map(article => ({link: article.url}))}));
    const usage = newUsage();
    const angles = await anglesOf(stories, latest.items.map(item => item.title),
        {language: 'fr', feedUrls, hours: latest.hours ?? 24, trusted: new Set(), usage});
    console.log(`angles of ${angles.size} cards, tokens ${JSON.stringify(usage)}`);
    // WATCH=Infantino,VAR: the news of these terms in the window of the briefing, as if the profile followed them
    const terms = (process.env.WATCH ?? '').split(',').map(term => term.trim()).filter(Boolean);
    const watched = terms.length === 0 ? latest.watched : await watchedNews(terms, {feedUrls, since: new Date(Date.now() - (latest.hours ?? 24) * 3600e3)});
    cached = {...latest, watched, items: latest.items.map(item => ({...item, angles: angles.get(item.storyId) ?? []}))};
    return cached;
};

app.get('/api/session', (req, res) => res.json({id: 1, username: 'mock', email: 'reader@example.test', role: 'User'}));
app.get('/api/profile', (req, res) => res.json({profile: {id: profileId, name: 'Profil', text: 'Mock', interests: [], watchTerms: []}}));
app.get('/api/profile/profiles', (req, res) => res.json({profiles: [{id: profileId, name: 'Profil'}]}));
app.get('/api/briefing', async (req, res) => res.json({briefing: await briefing(), mail: false}));
app.use('/api', (req, res) => res.status(404).json({error: 'Not in the mock.'}));
app.listen(3999, '127.0.0.1', () => console.log('mock API on 3999'));
