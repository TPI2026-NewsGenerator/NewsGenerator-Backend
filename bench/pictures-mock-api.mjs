// A local API answering the briefing page with the last briefing of a profile (env PROFILE_ID, 7 by
// default), the picture of each card looked for now as the briefing does (pictureOf: the thumbnails of
// its articles, else the og:image of its lead page read again). Reads only; nothing is changed. Port 3999
import express from 'express';
import {prisma} from '../config/db.js';
import {BriefingService, pictureOf, watchedNews, withMarks, withOwnTitles, withoutTakenOut} from '../services/briefing-service.js';
import {EntityModel} from '../models/entity-model.js';
import {EntityService} from '../services/entity-service.js';
import {Crawlers} from '../services/utils/crawlers.js';
import {briefingMail} from '../services/utils/briefing-mail.js';
import {ProfileService} from '../services/profile-service.js';
import {ProfileModel} from '../models/profile-model.js';
import {FeedService} from '../services/feed-service.js';
import {SourceService} from '../services/source-service.js';
import {RecommendationService} from '../services/recommendation-service.js';
import {rateLimit} from '../services/utils/rate-limit.js';
import {BriefingModel} from '../models/briefing-model.js';
import {storyPictures} from '../services/utils/mail-pictures.js';

const profileId = Number(process.env.PROFILE_ID ?? 7);
const app = express();
let cached = null;

const briefing = async () => {
    if (cached) return cached;
    const latest = await BriefingService.latest(profileId);
    const links = latest.items.flatMap(item => item.articles.map(article => article.url));
    const thumbnails = new Map((await prisma.$queryRawUnsafe('SELECT link, thumbnail FROM articles WHERE link = ANY($1)', links))
        .map(row => [row.link, row.thumbnail]));
    const leads = latest.items.map(item => item.lead ?? item.articles[0]);
    const pages = await Crawlers.Pages(leads.map(lead => lead.url));
    const content = new Map(pages.map(page => [page.url, page]));
    const items = latest.items.map((item, i) => {
        const articles = [leads[i], ...item.articles].map(article => ({link: article.url, thumbnail: thumbnails.get(article.url) ?? null}));
        return {...item, ...pictureOf(articles, content)};
    });
    console.log(`${items.filter(item => item.thumbnail).length} of ${items.length} cards with a picture (${latest.items.filter(item => item.thumbnail).length} before)`);
    // WATCH=Infantino,VAR: as if the profile followed these terms, their news looked for now and marked
    const terms = (process.env.WATCH ?? '').split(',').map(term => term.trim()).filter(Boolean);
    if (terms.length > 0) {
        const feedUrls = (await prisma.$queryRawUnsafe('SELECT url FROM feeds')).map(row => row.url);
        const watched = await watchedNews(terms, {feedUrls, since: new Date(Date.now() - (latest.hours ?? 24) * 3600e3)});
        cached = withMarks({...latest, items, watched}, terms);
        return cached;
    }
    cached = {...latest, items};
    return cached;
};

// the e-mail of the cards ?cards=1,2,3 (their place, all by default) as the server would send it, shown, never sent
// ?title=2:A title of mine, the title the reader wrote for the card at that place
// ?asked=1: the last e-mail the page asked, with its order, titles and the parts taken out (pictures aside)
let asked = null;
app.get('/mail-preview', async (req, res) => {
    const latest = await briefing();
    let items;
    if (req.query.asked && asked) {
        const byId = new Map(latest.items.map(item => [item.storyId, item]));
        items = withoutTakenOut(withOwnTitles(asked.storyIds.map(id => byId.get(id)).filter(Boolean), asked.titles), asked.removed);
    } else {
        const places = String(req.query.cards ?? '').split(',').map(Number).filter(Boolean);
        const picked = places.length ? places.map(place => latest.items[place - 1]).filter(Boolean) : latest.items;
        const [place, ...title] = String(req.query.title ?? '').split(':');
        items = withOwnTitles(picked, picked[Number(place) - 1] ? {[picked[Number(place) - 1].storyId]: title.join(':')} : {});
    }
    res.type('html').send(briefingMail({...latest, items}).html);
});
// MOCK_ADMIN=no: a reader who is not an administrator (no e-mail, one profile)
app.get('/api/session', (req, res) => res.json({id: 1, username: 'mock', email: 'reader@example.test', role: 2, admin: process.env.MOCK_ADMIN !== 'no'}));
// the profile as the API reads it (ProfileService.get), the terms followed kept in memory only, never
// in the database
let watchTerms = [];
// the names of an item added to the terms (EntityService.toTerms) read and kept here too
const realGet = ProfileModel.get;
Object.assign(ProfileModel, {
    get: async (id) => { const row = await realGet(id); return row && {...row, watch_terms: watchTerms}; },
    setWatchTerms: async (id, terms) => { watchTerms = terms; },
});
const mockProfile = async () => {
    const owner = (await ProfileModel.get(profileId)).id_user;
    const read = await ProfileService.get(owner, profileId);
    return {...read, profile: {...read.profile, watchTerms}};
};
app.get('/api/profile', async (req, res) => res.json(await mockProfile()));
app.get('/api/profile/options', (req, res) => res.json({languages: FeedService.languages()}));
// the sources added by hand: none shown here
app.get('/api/feeds', (req, res) => res.json({feeds: []}));
// the sites of a list checked as the API does (they are read on the web), never added: CHECK_MAX sites
// an hour (50 by default), to see the import stop and go on
const checkLimit = rateLimit({windowMs: 3600e3, max: Number(process.env.CHECK_MAX ?? 50), key: () => 'mock',
    cost: req => req.body?.sites?.length ?? 1, message: 'You checked 50 sites in the last hour, the most the mock checks.'});
app.get('/api/feeds/recommended', async (req, res) => res.json({sources: await RecommendationService.list(profileId)}));
app.post('/api/feeds/check', express.json(), checkLimit, async (req, res) => res.json({
    sites: await SourceService.checkSites({sites: req.body.sites, profileId, language: req.body.language ?? 'en'}),
}));
app.put('/api/profile/watch-terms', express.json(), async (req, res) => {
    if ((req.body?.terms ?? []).includes('refused')) return res.status(400).json({error: 'A term refused by the mock.'});
    watchTerms = req.body?.terms ?? [];
    res.json(await mockProfile());
});
app.get('/api/profile/profiles', async (req, res) => res.json({profiles: [{id: profileId, name: (await ProfileModel.get(profileId)).name ?? 'Profil'}]}));
app.get('/api/briefing', async (req, res) => res.json({briefing: await briefing(), mail: true}));
// the e-mail is never sent here: only what the page asks is shown (a file of the reader by its size)
app.post('/api/briefing/:id/email', express.json({limit: '9mb'}), (req, res) => {
    const pictures = Object.fromEntries(Object.entries(req.body?.pictures ?? {}).map(([id, p]) => [id, p?.data ? `file of ${p.data.length} base64 chars` : p]));
    console.log('email asked', JSON.stringify({...req.body, pictures}));
    asked = req.body;
    res.status(204).end();
});
app.get('/api/briefing/:id/stories/:storyId/pictures', async (req, res) => {
    const item = (await briefing()).items.find(card => card.storyId === Number(req.params.storyId));
    if (!item) return res.status(404).json({error: 'Unknown card.'});
    const rows = await BriefingModel.articlePictures(item.storyId, [item.lead, ...item.articles].filter(Boolean).map(article => article.url));
    res.json({pictures: storyPictures(item, rows)});
});
// The clubs, people and organisations followed: read from Wikidata and the news as the API does, their
// rows and the ones followed kept in memory only, never in the database
const rows = new Map();
const follows = new Map();      // id -> {added_names, removed_names, created_at}
let nextId = 1;
const rowById = (id) => [...rows.values()].find(row => row.id === id);
Object.assign(EntityModel, {
    byQid: async (qid) => rows.get(qid) ?? null,
    save: async (item) => {
        const row = {...(rows.get(item.qid) ?? {id: nextId++}), qid: item.qid, label: item.label, description: item.description,
            kind: item.kind, names: item.names, fetched_at: new Date()};
        row.linked = item.links.map(link => {
            if (!rows.has(link.qid)) rows.set(link.qid, {id: nextId++, ...link, names: [link.label], fetched_at: null});
            return {qid: link.qid, relation: link.relation};
        });
        rows.set(item.qid, row);
        return row.id;
    },
    links: async (id) => (rowById(id)?.linked ?? []).map(link => ({...rows.get(link.qid), relation: link.relation})),
    following: async (profile, id) => follows.get(id) ?? null,
    followed: async () => [...follows.entries()].map(([id, names]) => ({...rowById(id), ...names, links: rowById(id).linked?.length ?? 0})),
    count: async () => follows.size,
    follow: async (profile, id) => follows.set(id, follows.get(id) ?? {added_names: [], removed_names: []}),
    unfollow: async (profile, id) => Number(follows.delete(id)),
    setNames: async (profile, id, added, removed) => follows.set(id, {added_names: added, removed_names: removed}),
});
const entity = (work, status = 200) => async (req, res) => {
    try {
        res.status(status).json(await work(req));
    } catch (error) {
        res.status(error.status || 500).json({error: error.message});
    }
};
app.get('/api/entities', entity(async () => ({entities: await EntityService.list(profileId)})));
app.get('/api/entities/search', entity(async (req) => ({items: await EntityService.search(profileId, req.query.q)})));
app.post('/api/entities', express.json(), entity(async (req) => ({entities: await EntityService.follow(profileId, req.body?.qid)}), 201));
app.get('/api/entities/:qid', entity((req) => EntityService.page(profileId, req.params.qid, Number(req.query.hours ?? 48))));
app.put('/api/entities/:qid/names', express.json(), entity(async (req) => ({entity: await EntityService.setNames(profileId, req.params.qid, req.body)})));
app.post('/api/entities/:qid/terms', express.json(), entity((req) => EntityService.toTerms(profileId, req.params.qid, req.body?.names)));
app.delete('/api/entities/:qid', entity(async (req) => ({entities: await EntityService.unfollow(profileId, req.params.qid)})));
app.use('/api', (req, res) => res.status(404).json({error: 'Not in the mock.'}));
app.listen(3999, '127.0.0.1', () => console.log('mock API on 3999'));
