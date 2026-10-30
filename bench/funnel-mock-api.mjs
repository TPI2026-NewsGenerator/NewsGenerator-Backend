// A local API answering only what the signup page needs to write a profile with the AI: the languages
// and the two calls of the funnel, as the server answers them (the AI is the real one). No session, no
// account, nothing written in the database. Port 3999, for the client started with API_TARGET on it
import express from 'express';
import {ProfileService} from '../services/profile-service.js';
import {FeedService} from '../services/feed-service.js';

const app = express();
app.use(express.json());

const respond = async (res, fn) => {
    try {
        res.json(await fn());
    } catch (error) {
        res.status(error.status ?? 500).json({error: error.message});
    }
};
const timed = (name, fn) => async (req, res) => {
    const start = Date.now();
    await respond(res, fn.bind(null, req.body ?? {}));
    const rounds = Array.isArray(req.body?.rounds) ? req.body.rounds : [];
    console.log(`${name}: ${rounds.length} rounds sent, ${((Date.now() - start) / 1000).toFixed(1)} s, written: ${JSON.stringify(rounds.map(round => round.map(q => q.free)))}`);
};

app.get('/api/session', (req, res) => res.status(401).json({error: 'Not signed in.'}));
app.get('/api/profile/options', (req, res) => res.json({languages: FeedService.languages()}));
app.post('/api/profile/funnel/questions', timed('questions', ProfileService.funnelQuestions));
app.post('/api/profile/funnel/text', timed('text', ProfileService.funnelText));
app.use('/api', (req, res) => res.status(404).json({error: `Not in the mock: ${req.method} ${req.path}`}));

app.listen(3999, () => console.log('funnel mock API on 3999'));
