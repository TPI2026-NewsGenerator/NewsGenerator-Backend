// A local API answering the briefing page with the last briefing of a profile as saved (env PROFILE_ID, 7 by default), the e-mail bar shown, to see
// the news of another profile imported from the editor of the e-mail (MailImport): the list of the news of the other profiles of the account is the
// real one, read from the database (BriefingService.profilesNews); a news copied is added to the briefing in memory only (the card as the other
// briefing shows it, with the negative id the database would give), and the e-mail shown is the real one (briefingMail). No AI, nothing saved in the
// database. Port 3999, with the client of the "client-mock" launch configuration
import express from 'express';
import {BriefingService, transferredCard, withOwnTitles, withoutTakenOut} from '../services/briefing-service.js';
import {BriefingModel} from '../models/briefing-model.js';
import {briefingMail} from '../services/utils/briefing-mail.js';
import {foldInto} from '../services/utils/card-merge.js';
import {areVersions} from '../services/utils/card-versions.js';
import {prisma} from '../config/db.js';

const profileId = Number(process.env.PROFILE_ID ?? 7);
const app = express();
app.use(express.json({limit: '8mb'}));
const latest = await BriefingService.latest(profileId);
const [{id_user: userId}] = await prisma.$queryRawUnsafe('SELECT id_user FROM briefings WHERE id = $1', latest.id);
// the news copied since the mock started: 'briefingId:storyId' -> the id it has in the briefing
const copied = new Map();

app.get('/api/session', (req, res) => res.json({id: userId, username: 'mock', email: 'reader@example.test', role: 'Admin'}));
app.get('/api/profile', (req, res) => res.json({profile: {id: profileId, name: 'Enzo', text: 'Mock', interests: [], watchTerms: []}}));
app.get('/api/profile/profiles', (req, res) => res.json({profiles: [{id: profileId, name: 'Enzo'}]}));
app.get('/api/briefing', (req, res) => res.json({briefing: latest, mail: true}));
app.get('/api/briefing/:id/affairs', (req, res) => res.json({affairs: {}}));
app.get('/api/briefing/:id/versions', (req, res) => res.json({versions: {}}));

// the real list, with what was copied here since marked as in the briefing
app.get('/api/briefing/:id/profiles-news', async (req, res) => {
    try {
        const answer = await BriefingService.profilesNews(userId, latest.id);
        res.json({...answer, added: latest.items.filter(item => item.imported).length,
            profiles: answer.profiles.map(one => ({...one, news: one.news.map(news => ({...news, inBriefing: news.inBriefing || copied.has(`${one.briefingId}:${news.storyId}`)}))}))});
    } catch (err) {
        res.status(err.status ?? 500).json({error: err.message});
    }
});

// the card of the other briefing as the server copies it (see BriefingService.copyNews), added in memory
app.post('/api/briefing/:id/news/copy', async (req, res) => {
    try {
        const {fromBriefingId, storyId} = req.body ?? {};
        const other = await BriefingModel.ofUser(userId, Number(fromBriefingId));
        const found = (other?.items ?? []).find(card => card.storyId === Number(storyId));
        if (!found) return res.status(404).json({error: 'That briefing has no such news.'});
        const key = `${fromBriefingId}:${storyId}`;
        if (copied.has(key)) return res.status(409).json({error: 'This news is already in the briefing.'});
        const newId = -(copied.size + 1);
        copied.set(key, newId);
        const item = {...transferredCard(found), storyId: newId};
        // the card of the briefing that tells the same news, as BriefingService.copyNews says it
        const urls = new Set([item.lead, ...(item.articles ?? [])].map(article => article?.url).filter(Boolean));
        const closeAt = latest.items.findIndex(one => [one.lead, ...(one.articles ?? [])].some(article => urls.has(article?.url)) || areVersions(one, found));
        const close = closeAt < 0 ? null : latest.items[closeAt];
        latest.items.push(item);
        console.log(`news ${storyId} of the briefing ${fromBriefingId} copied as ${newId}`);
        res.status(201).json({item, analysis: null, analyzing: false,
            similar: close ? {storyId: close.storyId, number: closeAt + 1, title: close.titleTranslation ?? close.title, source: close.lead?.source ?? null} : null});
    } catch (err) {
        res.status(err.status ?? 500).json({error: err.message});
    }
});

// two cards of the same news made one, as BriefingService.foldNews does it, in memory
app.post('/api/briefing/:id/news/fold', (req, res) => {
    const {keep, drop} = req.body ?? {};
    const kept = latest.items.find(item => item.storyId === keep);
    const dropped = latest.items.find(item => item.storyId === drop);
    if (!kept || !dropped || keep === drop) return res.status(404).json({error: 'Unknown card.'});
    const folded = foldInto(kept, dropped);
    const at = Math.min(latest.items.indexOf(kept), latest.items.indexOf(dropped));
    latest.items = latest.items.filter(item => item !== kept && item !== dropped);
    latest.items.splice(at, 0, folded);
    console.log(`card ${drop} folded into ${keep} at ${at}`);
    res.json({item: folded, at, removed: drop});
});

// the e-mail as it is sent, for the cards of the editor
app.post('/api/briefing/:id/email/preview', (req, res) => {
    try {
        const {storyIds, titles, removed, format, ai = [], theme} = req.body ?? {};
        const byId = new Map(latest.items.map(item => [item.storyId, item]));
        const ticked = [...new Set(storyIds)].map(storyId => byId.get(storyId)).filter(Boolean);
        const items = withoutTakenOut(withOwnTitles(ticked, titles), removed);
        const mail = briefingMail({...latest, items: items.map(item => ai.includes(item.storyId) ? {...item, aiVersion: true} : item)},
            {profile: 'Enzo', format: format ?? 'passages', theme: theme ?? 'light', anchors: true});
        res.json({html: mail.html});
    } catch (err) {
        res.status(err.status ?? 500).json({error: err.message});
    }
});
app.get('/api/briefing/:id/stories/:storyId/pictures', (req, res) => {
    const item = latest.items.find(one => one.storyId === Number(req.params.storyId));
    res.json({pictures: item?.pictures ?? []});
});
app.use('/api', (req, res) => res.status(404).json({error: 'Not in the mock.'}));
app.listen(3999, '127.0.0.1', () => console.log(`mock API on 3999, briefing ${latest.id}, ${latest.items.length} cards`));
