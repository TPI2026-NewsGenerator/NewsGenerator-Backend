//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: test.briefing-export.js
//  Description: GET /api/v1/briefing/news, the cards the briefings of ALL the readers chose, for the system of another party: what is asked is checked
//               (a refusal names the parameter, and nothing is read), what is asked of the database (a story once by default, the cursor is the time
//               the briefing was ready, the briefing and the place of the card), and what is given back (the story, its articles, what we found around
//               it) with NOTHING that says who it was chosen for or why. The database is not here: the model is a double that answers what the SQL would
//

import {Buffer} from 'node:buffer';
import http from 'node:http';
import process from 'node:process';
import {afterAll, beforeAll, beforeEach, describe, expect, it, jest} from '@jest/globals';
import express from 'express';
import {hashOfKey, newApiKey} from '../../services/utils/api-key.js';

const find = jest.fn();
jest.unstable_mockModule('../../models/briefing-export-model.js', () => ({BriefingExportModel: {find}}));
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const {default: v1Router} = await import('../../routes/v1-router.js');
const {decodeCursor, encodeCursor, itemOf, passagesOf} = await import('../../services/briefing-export-service.js');

const KEY = newApiKey();
process.env.API_KEYS = `friend:${hashOfKey(KEY)}`;
const app = express();
app.use('/api/v1', v1Router);

let server;
beforeAll(async () => { await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); }); });
afterAll(() => server.close());

const call = (query, {key = KEY} = {}) => new Promise((resolve, reject) => {
    const req = http.request({host: '127.0.0.1', port: server.address().port, path: `/api/v1/briefing/news${query ? `?${query}` : ''}`, method: 'GET', headers: key ? {Authorization: `Bearer ${key}`} : {}}, res => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { text += chunk; });
        res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: text === '' ? null : JSON.parse(text)}));
    });
    req.on('error', reject);
    req.end();
});

// a card as a briefing keeps it, with what is of the reader in it (the profile, the thumb, the sending, the AI wording, the translations)
const card = (more = {}) => ({
    storyId: 501, mergedStoryIds: [502], followUp: {storyId: 400, title: 'READER-HISTORY', shownAt: '2026-11-01T00:00:00Z', evolved: true}, vote: 'up', votedAt: '2026-11-06T00:00:00Z',
    feedUrls: ['https://feeds.example/READER-FEED'], title: 'A rewritten title', titleAsPublished: 'The title as published', titleRewritten: true, titleProposal: null,
    lead: {title: 'The title as published', url: 'https://example.org/lead', source: 'example.org', publishedAt: '2026-11-05T09:00:00.000Z', trusted: true, language: 'en'},
    titleTranslation: 'TRANSLATED-TITLE', language: 'en', why: 'READER-INTEREST-SENTENCE', interest: 'Football: FIFA', project: 'READER-PROJECT',
    summary: 'First passage.\nSecond passage.', translation: 'TRANSLATED-PASSAGES', points: ['AI-POINT'], digest: 'DIGEST', ai: {points: ['AI-WORDING'], summary: 'AI-SUMMARY', model: 'm'},
    topic: 'football', sourcing: 'named', hedged: 'reportedly', sentAt: '2026-11-05T12:00:00Z',
    contested: [{by: 'The club', sentence: 'We deny it.', translation: 'TR', language: 'en', source: 'club.example', url: 'https://club.example/denial', publishedAt: '2026-11-05T11:00:00Z'}],
    official: [{party: 'The club', title: 'Statement', url: 'https://club.example/statement', channel: 'website', publishedAt: '2026-11-05T11:30:00Z'}],
    names: [{name: 'A Person', qid: 'Q42', kind: 'person'}], countries: ['CH'], thumbnail: 'https://img.example/x.jpg',
    publishedAt: '2026-11-05T10:00:00.000Z',
    corroboration: {media: 4, read: 3, independent: 2, agencies: ['AFP'], mediaNames: ['example.org']},
    articles: [
        {title: 'The title as published', url: 'https://example.org/lead', source: 'example.org', publishedAt: '2026-11-05T09:00:00.000Z', trusted: true, language: 'en'},
        {title: 'Another medium', url: 'https://other.example/story', source: 'other.example', publishedAt: '2026-11-05T10:00:00.000Z', trusted: false, language: 'fr'},
    ],
    ...more,
});

// a row as the model gives it
let nextBriefing = 10;
const row = (more = {}) => {
    const briefing = nextBriefing++;
    return {briefing, position: 1, card: card(), story: 501, seen: `2026-11-06T08:00:00.${String(briefing).padStart(6, '0')}Z`, readers: 2, ...more};
};

beforeEach(() => {
    find.mockReset().mockResolvedValue([]);
});

describe('who and what is asked', () => {
    it('should need the key of a client, like the rest of /api/v1', async () => {
        expect((await call('', {key: null})).status).toBe(401);
        expect(find).not.toHaveBeenCalled();
    });

    it('should give each story once, the oldest briefing first, by default', async () => {
        expect((await call('')).status).toBe(200);
        expect(find).toHaveBeenCalledWith({since: null, until: null, topics: [], dedupe: 'story', order: 'asc', limit: 50, after: null});
    });

    it('should pass on what is asked', async () => {
        await call('dedupe=none&order=desc&limit=100&since=2026-11-01&until=2026-11-08T00:00:00Z&topic=sport,politics');
        expect(find).toHaveBeenCalledWith(expect.objectContaining({topics: ['sport', 'politics'], dedupe: 'none', order: 'desc', limit: 100, since: '2026-11-01T00:00:00.000Z', until: '2026-11-08T00:00:00.000Z'}));
    });

    it('should refuse what it does not understand with a 422 that names the parameter, and read nothing', async () => {
        const refused = [['dedupe=all', 'dedupe'], ['topic=cooking', 'topic'], ['order=up', 'order'], ['limit=0', 'limit'], ['limit=101', 'limit'], ['since=yesterday', 'since'], ['since=2026-11-08&until=2026-11-01', 'until'], ['cursor=garbage', 'cursor'], ['limit=5&limit=6', 'limit']];
        for (const [query, parameter] of refused) {
            const res = await call(query);
            expect(res.status).toBe(422);
            expect(res.body.error).toMatchObject({code: 'invalid_parameter', parameter});
        }
        expect(find).not.toHaveBeenCalled();
    });
});

describe('what is given back', () => {
    it('should give the story, its articles and what we found around it', async () => {
        find.mockResolvedValue([row({briefing: 12, seen: '2026-11-06T08:00:00.000012Z'})]);
        const res = await call('');
        expect(res.headers['cache-control']).toBe('private, max-age=60');
        expect(res.body.dedupe).toBe('story');
        expect(res.body.items).toEqual([{
            id: 501,
            merged_story_ids: [502],
            selected_at: '2026-11-06T08:00:00.000012Z',
            readers: 2,
            language: 'en',
            articles_total: 2,
            articles: [
                {url: 'https://example.org/lead', title: 'The title as published', medium: 'example.org', language: 'en', published_at: '2026-11-05T09:00:00.000Z'},
                {url: 'https://other.example/story', title: 'Another medium', medium: 'other.example', language: 'fr', published_at: '2026-11-05T10:00:00.000Z'},
            ],
            key_passages: ['First passage.', 'Second passage.'],
            reading: {
                topic: 'football', sourcing: 'named', hedged_by: 'reportedly',
                corroboration: {media: 4, read: 3, independent: 2, agencies: ['AFP']},
                denied_by: [{by: 'The club', sentence: 'We deny it.', medium: 'club.example', url: 'https://club.example/denial', published_at: '2026-11-05T11:00:00.000Z'}],
                official_posts: [{party: 'The club', title: 'Statement', channel: 'website', url: 'https://club.example/statement', published_at: '2026-11-05T11:30:00.000Z'}],
            },
            names: [{name: 'A Person', qid: 'Q42', kind: 'person'}],
        }]);
    });

    it('should say NOTHING of who the story was chosen for or why: no profile, thumb, sending, history, feed, rewrite or AI wording', async () => {
        find.mockResolvedValue([row()]);
        const text = JSON.stringify((await call('')).body);
        for (const secret of ['READER-INTEREST-SENTENCE', 'Football: FIFA', 'READER-PROJECT', 'READER-HISTORY', 'READER-FEED', 'TRANSLATED-TITLE', 'TRANSLATED-PASSAGES', 'AI-POINT', 'AI-WORDING', 'AI-SUMMARY',
            'DIGEST', 'A rewritten title', 'sentAt', 'votedAt', 'trusted', 'thumbnail', 'followUp', 'feedUrls', 'user', 'profile']) {
            expect(text).not.toContain(secret);
        }
    });

    it('should leave out a link that carries a secret, put the next article first when it was the lead, and leave out a card with no link to give', async () => {
        const secretLead = card({lead: {...card().lead, url: 'https://example.org/lead?token=abc'}, articles: [
            {title: 'With a key', url: 'https://example.org/lead?token=abc', source: 'example.org', language: 'en'},
            {title: 'Another medium', url: 'https://other.example/story', source: 'other.example', language: 'fr'}], contested: [{by: 'x', sentence: 'y', url: 'https://club.example/d?key=secret'}]});
        const nothing = card({lead: {title: 'x', url: 'https://example.org/x?token=abc'}, articles: [{title: 'y', url: 'https://example.org/y?key=abc'}]});
        const rows = [row({card: secretLead, story: 1}), row({card: nothing, story: 2})];
        find.mockResolvedValue(rows);
        const res = await call('');
        expect(res.body.items).toHaveLength(1);
        expect(res.body.items[0].articles[0].url).toBe('https://other.example/story');
        expect(res.body.items[0].reading.denied_by[0].url).toBeNull();
        expect(JSON.stringify(res.body)).not.toMatch(/token=|key=/);
        // the card left out does not stop the client: the cursor goes on from the last card read
        expect(decodeCursor(res.body.next_cursor)).toEqual({seen: rows[1].seen, briefing: rows[1].briefing, position: 1});
    });

    it('should give 20 articles of a card at most, and say how many there are', () => {
        const many = Array.from({length: 30}, (_, i) => ({title: `T${i}`, url: `https://m${i}.example/a`, source: `m${i}.example`}));
        const item = itemOf({story: 9, seen: 'a', first_seen: 'b', briefings: 1, readers: 1, card: card({lead: many[0], articles: many})});
        expect(item.articles).toHaveLength(20);
        expect(item.articles_total).toBe(30);
        expect(item.articles[0].url).toBe('https://m0.example/a');
    });

    it('should read a card written before most of its fields existed', () => {
        const item = itemOf({story: 7, seen: 'a', first_seen: 'b', briefings: 1, readers: 1, card: {storyId: 7, lead: {title: 'Old', url: 'https://example.org/old'}}});
        expect(item).toMatchObject({id: 7, merged_story_ids: [], key_passages: [], names: [], language: null, articles_total: 1});
        expect(item.articles[0]).toMatchObject({url: 'https://example.org/old', title: 'Old'});
        expect(item.reading).toEqual({topic: null, sourcing: null, hedged_by: null, corroboration: {media: null, read: null, independent: null, agencies: []}, denied_by: [], official_posts: []});
        expect(itemOf({story: 8, card: {}})).toBeNull();
    });

    it('should give the key passages one by one, as the card keeps them', () => {
        expect(passagesOf('One.\n\nTwo <b>words</b>.\n')).toEqual(['One.', 'Two words .']);
        expect(passagesOf(null)).toEqual([]);
        expect(passagesOf(Array.from({length: 12}, (_, i) => `P${i}`).join('\n'))).toHaveLength(8);
    });
});

describe('the cursor', () => {
    it('should go on from the last card read, and say whether there is a next page', async () => {
        const rows = [row({position: 1}), row({position: 2}), row({position: 3})];
        find.mockResolvedValue(rows);
        const res = await call('limit=2');
        expect(res.body.has_more).toBe(true);
        expect(res.body.items).toHaveLength(2);
        expect(decodeCursor(res.body.next_cursor)).toEqual({seen: rows[1].seen, briefing: rows[1].briefing, position: 2});

        find.mockClear();
        await call(`cursor=${res.body.next_cursor}`);
        expect(find).toHaveBeenCalledWith(expect.objectContaining({after: {seen: rows[1].seen, briefing: rows[1].briefing, position: 2}}));
    });

    it('should keep a cursor on the last page, for the client that comes back the next day, and none for an empty page', async () => {
        const last = row();
        find.mockResolvedValue([last]);
        const res = await call('');
        expect(res.body.has_more).toBe(false);
        expect(res.body.next_cursor).toBe(encodeCursor(last.seen, last.briefing, last.position));
        find.mockResolvedValue([]);
        expect((await call('')).body.next_cursor).toBeNull();
    });

    it('should refuse a cursor that is not the one of a card', () => {
        for (const value of ['', 'x', Buffer.from('2026-11-06T08:00:00Z|1|1').toString('base64url'), Buffer.from('2026-11-06T08:00:00.000001Z|1').toString('base64url'),
            Buffer.from('2026-11-06T08:00:00.000001Z|a|1').toString('base64url')]) {
            expect(decodeCursor(value)).toBeNull();
        }
        expect(decodeCursor(encodeCursor('2026-11-06T08:00:00.000001Z', 5, 2))).toEqual({seen: '2026-11-06T08:00:00.000001Z', briefing: 5, position: 2});
    });
});
