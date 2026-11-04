// A local API answering the briefing page with the last briefing of a profile (env PROFILE_ID, 7 by default) and
// the REAL affairs of its cards (AffairService: chips, then the view built on the first request): to see them in a
// browser without a session. Reads only; nothing is changed. Port 3999, with the client of "client-affair" (5176)
import express from 'express';
import {prisma} from '../../config/db.js';
import {BriefingService} from '../../services/briefing-service.js';
import {AffairService} from '../../services/affair-service.js';

const profileId = Number(process.env.PROFILE_ID ?? 7);
const app = express();
let cached = null;

const latest = async () => {
    if (!cached) {
        const briefing = await BriefingService.latest(profileId);
        const [row] = await prisma.$queryRawUnsafe('SELECT id_user FROM briefings WHERE id = $1', briefing.id);
        cached = {briefing, userId: row.id_user};
    }
    return cached;
};
const wrap = (handler) => async (req, res) => {
    try {
        res.json(await handler(req));
    } catch (error) {
        res.status(error.status || 500).json({error: error.message ?? String(error)});
    }
};

app.get('/api/session', (req, res) => res.json({id: 1, username: 'mock', email: 'reader@example.test', role: 'User'}));
app.get('/api/profile', (req, res) => res.json({profile: {id: profileId, name: 'Profil', text: 'Mock', interests: [], watchTerms: []}}));
app.get('/api/profile/profiles', (req, res) => res.json({profiles: [{id: profileId, name: 'Profil'}]}));
app.get('/api/briefing', wrap(async () => ({briefing: (await latest()).briefing, mail: true})));
app.get('/api/briefing/:id/affairs', wrap(async (req) => ({affairs: await AffairService.chips((await latest()).userId, req.params.id)})));
app.get('/api/briefing/:id/stories/:storyId/affair', wrap(async (req) => AffairService.view((await latest()).userId, req.params.id, req.params.storyId)));
// the affairs followed live in memory here (their tables are made by db/add_affairs.sql): the real affair of the card is kept, its
// last two key events stand for alerts, to see the pages without a session and without the migration
app.use(express.json());
const followed = new Map();
let nextId = 1;
const summary = (one) => ({id: one.id, title: one.view.title, followedAt: one.at, lastEventAt: one.view.events.at(-1)?.at ?? null, unread: one.unread,
    events: one.view.events.length, key: one.view.events.filter(e => e.kind === 'key').length, media: one.view.coverage?.media ?? 0, last: one.view.events.at(-1) ?? null});
app.get('/api/affairs', wrap(async () => ({affairs: [...followed.values()].map(summary), unread: [...followed.values()].reduce((n, one) => n + one.unread, 0)})));
// the e-mail as it would be sent, drawn by the real server for what the editor of the e-mail has chosen: nothing is sent (no route sends)
app.post('/api/briefing/:id/email/preview', wrap(async (req) => {
    const {userId} = await latest();
    const b = req.body ?? {};
    return BriefingService.preview(userId, req.params.id, b.storyIds, null, b.pictures, b.titles, b.removed, b.format, b.ai, b.texts, b.countries, b.theme, b.timeZone, b.blocks);
}));
app.get('/api/affairs/unread', wrap(async () => ({unread: [...followed.values()].reduce((n, one) => n + one.unread, 0)})));
app.get('/api/affairs/push/key', (req, res) => res.json({enabled: false, publicKey: null}));
app.post('/api/affairs', wrap(async (req) => {
    const {userId} = await latest();
    const view = await AffairService.view(userId, req.body.briefingId, req.body.storyId);
    const found = [...followed.values()].find(one => one.storyId === req.body.storyId);
    if (found) return {id: found.id, already: true};
    const id = nextId++;
    followed.set(id, {id, storyId: req.body.storyId, view, at: new Date().toISOString(), unread: 2});
    return {id, already: false};
}));
app.get('/api/affairs/:id', wrap(async (req) => {
    const one = followed.get(Number(req.params.id));
    if (!one) throw Object.assign(new Error('Unknown affair.'), {status: 404});
    const alerts = one.view.events.filter(e => e.kind === 'key').slice(-2).map((event, i) => ({id: i + 1, at: event.at, read: one.unread === 0, event}));
    return {id: one.id, title: one.view.title, followedAt: one.at, lastEventAt: one.view.events.at(-1)?.at, events: one.view.events, coverage: one.view.coverage, alerts};
}));
app.post('/api/affairs/:id/seen', (req, res) => { const one = followed.get(Number(req.params.id)); if (one) one.unread = 0; res.status(204).end(); });
app.delete('/api/affairs/:id', (req, res) => { followed.delete(Number(req.params.id)); res.status(204).end(); });
app.use('/api', (req, res) => res.status(404).json({error: 'Not in the mock.'}));
app.listen(3999, '127.0.0.1', () => console.log('mock API on 3999'));
