// A local API answering the briefing page with the last briefing of a profile as saved, its analysis
// with it (env PROFILE_ID, 7 by default), the e-mail bar shown: an e-mail asked is written as
// BriefingService.email writes it (the cards ticked with their analysis, the lines taken out left out,
// briefingMail) to bench/data/mail-analysis/last.html and .txt instead of being sent. No AI, nothing
// saved in the database. Port 3999, with the client of the "client-mock" launch configuration
import express from 'express';
import fs from 'node:fs';
import {BriefingService, withOwnTitles, withoutTakenOut} from '../services/briefing-service.js';
import {briefingMail} from '../services/utils/briefing-mail.js';

const profileId = Number(process.env.PROFILE_ID ?? 7);
const OUT = new URL('./data/mail-analysis/', import.meta.url);
fs.mkdirSync(OUT, {recursive: true});
const app = express();
app.use(express.json({limit: '8mb'}));
const latest = await BriefingService.latest(profileId);

app.get('/api/session', (req, res) => res.json({id: 1, username: 'mock', email: 'reader@example.test', role: 'Admin'}));
app.get('/api/profile', (req, res) => res.json({profile: {id: profileId, name: 'Profil', text: 'Mock', interests: [], watchTerms: []}}));
app.get('/api/profile/profiles', (req, res) => res.json({profiles: [{id: profileId, name: 'Profil'}]}));
app.get('/api/briefing', (req, res) => res.json({briefing: latest, mail: true}));
app.post('/api/briefing/:id/email', (req, res) => {
    try {
        const {storyIds, titles, removed, format, ai = []} = req.body ?? {};
        const analyses = latest.analysis?.status === 'ready' ? latest.analysis.cards ?? {} : {};
        const byId = new Map(latest.items.map(item => [item.storyId, analyses[item.storyId]
            ? {...item, analysis: {...analyses[item.storyId], model: latest.analysis.model}} : item]));
        const ticked = [...new Set(storyIds)].map(storyId => byId.get(storyId)).filter(Boolean);
        const items = withoutTakenOut(withOwnTitles(ticked, titles), removed);
        const mail = briefingMail({...latest, items: items.map(item => ai.includes(item.storyId) ? {...item, aiVersion: true} : item)}, {profile: 'Profil', format: format ?? 'passages'});
        fs.writeFileSync(new URL('last.html', OUT), mail.html);
        fs.writeFileSync(new URL('last.txt', OUT), mail.text);
        fs.writeFileSync(new URL('last-request.json', OUT), JSON.stringify(req.body, null, 1));
        console.log(`e-mail of ${items.length} cards written, removed ${JSON.stringify(removed ?? {})}, AI version ${JSON.stringify(ai)}`);
        res.status(204).end();
    } catch (err) {
        res.status(err.status ?? 500).json({error: err.message});
    }
});
app.use('/api', (req, res) => res.status(404).json({error: 'Not in the mock.'}));
app.listen(3999, '127.0.0.1', () => console.log(`mock API on 3999, briefing ${latest.id}, ${latest.items.length} cards, analysis ${latest.analysis?.status}`));
