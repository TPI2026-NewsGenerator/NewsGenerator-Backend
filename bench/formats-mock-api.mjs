// A local API answering the briefing page with the last briefing of a profile (env PROFILE_ID, 7 by
// default, LANGUAGE its reader's, fr by default), the article of each card read again and its key
// passages chosen again with extractArticle, to see the shorter ways of a card (points, digest) on a real
// briefing without a session. Reads only; nothing is changed. Port 3999, with the client of the
// "client-mock" launch configuration
import express from 'express';
import {BriefingService} from '../services/briefing-service.js';
import {Crawlers} from '../services/utils/crawlers.js';
import {canSummarize, extractArticle, passagesText} from '../services/utils/extract.js';
import {newUsage} from '../services/utils/ollama.js';
import {aiWaysOf} from '../services/utils/ai-ways.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';

const profileId = Number(process.env.PROFILE_ID ?? 7);
const language = process.env.LANGUAGE ?? 'fr';
const app = express();
let cached = null;

const briefing = async () => {
    if (cached) return cached;
    const latest = await BriefingService.latest(profileId);
    const leads = latest.items.map(item => item.lead ?? item.articles[0]);
    const pages = new Map((await Crawlers.Html(leads.map(lead => lead.url))).map(page => [page.url, page]));
    const usage = newUsage(), writing = newUsage();
    const t = Date.now();
    const read = await mapWithConcurrency(latest.items, 4, async (item, i) => {
        const page = pages.get(leads[i].url);
        if (!canSummarize(page?.content)) return null;
        const [extract, ai] = await Promise.all([extractArticle(leads[i].title, page, {language, usage}),
            aiWaysOf(leads[i].title, page, {language, usage: writing}).catch(() => null)]);
        return extract.passages.length === 0 ? null : {...extract, ai};
    });
    const items = latest.items.map((item, i) => {
        const extract = read[i].status === 'fulfilled' ? read[i].value : null;
        // a page that can't be read again keeps the card of the briefing, with its key passages only
        if (!extract) return item;
        return {...item, summary: passagesText(extract.passages), translation: passagesText(extract.translation),
            points: passagesText(extract.points), pointsTranslation: passagesText(extract.pointsTranslation),
            digest: passagesText(extract.digest), digestTranslation: passagesText(extract.digestTranslation), ai: extract.ai};
    });
    console.log(`${items.filter(item => item.digest).length} of ${items.length} cards read again, ${items.filter(item => item.ai).length} with an AI version, tokens ${JSON.stringify(usage)}, writing ${JSON.stringify(writing)}, ${Math.round((Date.now() - t) / 1000)} s`);
    cached = {...latest, items};
    return cached;
};

app.get('/api/session', (req, res) => res.json({id: 1, username: 'mock', email: 'reader@example.test', role: 'User'}));
app.get('/api/profile', (req, res) => res.json({profile: {id: profileId, name: 'Profil', text: 'Mock', interests: [], watchTerms: []}}));
app.get('/api/profile/profiles', (req, res) => res.json({profiles: [{id: profileId, name: 'Profil'}]}));
app.get('/api/briefing', async (req, res) => res.json({briefing: await briefing(), mail: false}));
app.use('/api', (req, res) => res.status(404).json({error: 'Not in the mock.'}));
app.listen(3999, '127.0.0.1', () => console.log('mock API on 3999'));
