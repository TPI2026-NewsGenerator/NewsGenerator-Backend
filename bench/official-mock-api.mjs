// A local API answering the briefing page with the last briefing of a profile (env PROFILE_ID, 7 by
// default), its cards given the official sources bench/official-live.mjs found for them
// (bench/data/official-live.txt): to see the "Official source" of a card in a browser without a
// session. Reads only; nothing is changed. Port 3999, with the client of the "client-mock" launch configuration
import fs from 'node:fs';
import express from 'express';
import {BriefingService} from '../services/briefing-service.js';

const profileId = Number(process.env.PROFILE_ID ?? 7);
const official = new Map();
let card = null;
for (const line of fs.readFileSync(new URL('./data/official-live.txt', import.meta.url), 'utf8').split('\n')) {
    const head = line.match(/^ {2}#(\d+) /);
    if (head) { card = Number(head[1]); official.set(card, []); continue; }
    const post = line.match(/^ {4}(.+?) \((\w+), ([\d?-]+)\): (.*) {2}<(.+)>$/);
    if (post && card) official.get(card).push({party: post[1], channel: post[2], publishedAt: post[3] === '?' ? null : `${post[3]}T12:00:00.000Z`, title: post[4], url: post[5]});
}

const app = express();
app.get('/api/session', (req, res) => res.json({id: 1, username: 'mock', email: 'reader@example.test', role: 'User'}));
app.get('/api/profile', (req, res) => res.json({profile: {id: profileId, name: 'Profil', text: 'Mock', interests: [], watchTerms: []}}));
app.get('/api/profile/profiles', (req, res) => res.json({profiles: [{id: profileId, name: 'Profil'}]}));
app.get('/api/briefing', async (req, res) => {
    const latest = await BriefingService.latest(profileId);
    res.json({briefing: {...latest, items: latest.items.map(item => ({...item, official: official.get(item.storyId) ?? []}))}, mail: false});
});
app.use('/api', (req, res) => res.status(404).json({error: 'Not in the mock.'}));
app.listen(3999, '127.0.0.1', () => console.log(`mock API on 3999, official sources of ${official.size} cards`));
