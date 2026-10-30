// A local API answering the briefing page with the last briefing of a profile (env PROFILE_ID, 7 by
// default), its first card given a follow-up and an official statement reported by an article: to see
// the bar of 1 to 7 days, the follow-up sent by e-mail and the "Official source" quoted, without a
// session. Reads only; nothing is changed. Port 3999, with the client of the "client-mock" launch
// configuration
import express from 'express';
import {BriefingService} from '../services/briefing-service.js';

const profileId = Number(process.env.PROFILE_ID ?? 7);
const app = express();
app.use(express.json());
app.get('/api/session', (req, res) => res.json({id: 1, username: 'mock', email: 'reader@example.test', role: 'User'}));
app.get('/api/profile', (req, res) => res.json({profile: {id: profileId, name: 'Profil', text: 'Mock', interests: [], watchTerms: []}}));
app.get('/api/profile/profiles', (req, res) => res.json({profiles: [{id: profileId, name: 'Profil'}]}));
app.get('/api/briefing', async (req, res) => {
    const briefing = await BriefingService.latest(profileId);
    const [first, ...rest] = briefing.items;
    res.json({mail: true, briefing: {...briefing, items: [{...first,
        followUp: {storyId: first.storyId, title: first.titleTranslation ?? first.title, shownAt: new Date(Date.now() - 864e5).toISOString(), evolved: true},
        official: [{party: 'FPF', title: 'A FPF publicou um comunicado a confirmar a suspensão.', translation: 'The FPF published a statement confirming the suspension.',
            language: 'pt', url: 'https://www.abola.pt/', source: 'abola.pt', channel: 'reported', publishedAt: null}]}, ...rest]}});
});
app.use('/api', (req, res) => res.status(404).json({error: 'Not in the mock.'}));
app.listen(3999, () => console.log('window mock API on http://localhost:3999'));
