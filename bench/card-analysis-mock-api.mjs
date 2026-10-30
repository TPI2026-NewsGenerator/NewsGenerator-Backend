// A local API answering the briefing page with the last briefing of a profile (env PROFILE_ID, 7 by
// default, LANGUAGE its reader's, en by default) and the analysis of its cards written again as the
// briefing writes it (cardAnalyses of briefing-service.js), from their pages read again, started with
// the server: 'running', then the cards picked, then written. Reads only; nothing is saved. Port 3999,
// with the client of the "client-mock" launch configuration
import express from 'express';
import {BriefingService, analysisArticles, cardAnalyses} from '../services/briefing-service.js';
import {ANALYSIS_MODEL} from '../services/utils/card-analysis.js';
import {Crawlers} from '../services/utils/crawlers.js';
import {newUsage} from '../services/utils/ollama.js';

const profileId = Number(process.env.PROFILE_ID ?? 7);
const language = process.env.LANGUAGE ?? 'en';
const app = express();
const latest = await BriefingService.latest(profileId);
const running = {status: 'running', model: ANALYSIS_MODEL, startedAt: new Date().toISOString()};
let analysis = running;

// the stories as the briefing had them: its articles, the lead among them
const news = (article) => article && {link: article.url, title: article.title, at: article.publishedAt ? new Date(article.publishedAt) : null};
const items = latest.items;
const stories = items.map(item => ({storyId: item.storyId, members: (item.articles ?? []).map(news)}));
const leads = items.map((item, i) => {
    const lead = item.lead ?? item.articles?.[0];
    return stories[i].members.find(article => article.link === lead?.url) ?? news(lead);
});
const usage = newUsage();
const started = Date.now();
(async () => {
    const urls = [...new Set(stories.flatMap(story => story.members.map(article => article.link)))];
    const pages = new Map((await Crawlers.Html(urls)).filter(page => page.content).map(page => [page.url, page]));
    const articles = analysisArticles(stories, {lead: (i) => leads[i], summary: (i) => items[i].summary, readOf: (article) => pages.get(article.link)});
    console.log(`${pages.size} of ${urls.length} pages read in ${Math.round((Date.now() - started) / 1000)} s`);
    analysis = await cardAnalyses(items, articles, language, {usage, onPicked: async (picked) => {
        analysis = {...running, picked};
        console.log(`picked ${picked.length}: ${JSON.stringify(picked)}`);
    }});
    console.log(`analysis in ${Math.round((Date.now() - started) / 1000)} s, ${Object.keys(analysis.cards).length} cards written, ${analysis.dropped} lines dropped, tokens ${JSON.stringify(usage)}`);
    console.log(JSON.stringify(analysis.cards, null, 1));
})().catch(err => {
    analysis = {status: 'failed'};
    console.error(`analysis failed: ${err.stack}`);
});

app.get('/api/session', (req, res) => res.json({id: 1, username: 'mock', email: 'reader@example.test', role: 'User'}));
app.get('/api/profile', (req, res) => res.json({profile: {id: profileId, name: 'Profil', text: 'Mock', interests: [], watchTerms: []}}));
app.get('/api/profile/profiles', (req, res) => res.json({profiles: [{id: profileId, name: 'Profil'}]}));
app.get('/api/briefing', (req, res) => res.json({briefing: {...latest, analysis}, mail: false}));
app.use('/api', (req, res) => res.status(404).json({error: 'Not in the mock.'}));
app.listen(3999, '127.0.0.1', () => console.log(`mock API on 3999, ${items.length} cards`));
