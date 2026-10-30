// A local API answering the briefing page with the last briefing of a profile (env PROFILE_ID, 7 by
// default, LANGUAGE its reader's, en by default) and its analysis written again by the AI from its cards
// (see briefing-analysis.js), started with the server: 'running' until it is written, as on a new
// briefing. Reads only; nothing is changed. Port 3999, with the client of the "client-mock" launch configuration
import express from 'express';
import {BriefingService} from '../services/briefing-service.js';
import {ANALYSIS_MODEL, analysisOf} from '../services/utils/briefing-analysis.js';
import {newUsage} from '../services/utils/ollama.js';

const profileId = Number(process.env.PROFILE_ID ?? 7);
const language = process.env.LANGUAGE ?? 'en';
const app = express();
const latest = await BriefingService.latest(profileId);
let analysis = {status: 'running', model: ANALYSIS_MODEL, startedAt: new Date().toISOString()};
const usage = newUsage();
const started = Date.now();
analysisOf(latest.items, language, usage)
    .then(result => {
        analysis = result ?? {status: 'failed'};
        console.log(`analysis by ${result?.model} in ${Math.round((Date.now() - started) / 1000)} s, ${result?.changed.length} changes, ${result?.risks.length} risks, ${result?.dropped} dropped, tokens ${JSON.stringify(usage)}`);
        console.log(JSON.stringify(result, null, 1));
    })
    .catch(err => {
        analysis = {status: 'failed'};
        console.error(`analysis failed: ${err.message}`);
    });

app.get('/api/session', (req, res) => res.json({id: 1, username: 'mock', email: 'reader@example.test', role: 'User'}));
app.get('/api/profile', (req, res) => res.json({profile: {id: profileId, name: 'Profil', text: 'Mock', interests: [], watchTerms: []}}));
app.get('/api/profile/profiles', (req, res) => res.json({profiles: [{id: profileId, name: 'Profil'}]}));
app.get('/api/briefing', (req, res) => res.json({briefing: {...latest, analysis}, mail: false}));
app.use('/api', (req, res) => res.status(404).json({error: 'Not in the mock.'}));
app.listen(3999, '127.0.0.1', () => console.log(`mock API on 3999, ${latest.items.length} cards`));
