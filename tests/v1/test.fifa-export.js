//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: test.fifa-export.js
//  Description: GET /api/v1/fifa/news, the passages of the news selected for the map "The FIFA presidency", for the system of another party: what is
//               asked is checked (a refusal names the parameter, and nothing is read), what is asked of the database (the passages we select by
//               default, the cursor goes on from the time a signal last changed), and what is given back (the passage, how we read it, the news
//               it is in, never a link that carries a secret). The database is not here: the model is a double that answers what the SQL would
//

import http from 'node:http';
import process from 'node:process';
import {afterAll, beforeAll, beforeEach, describe, expect, it, jest} from '@jest/globals';
import express from 'express';
import {hashOfKey, newApiKey} from '../../services/utils/api-key.js';

const find = jest.fn();
jest.unstable_mockModule('../../models/fifa-export-model.js', () => ({FifaExportModel: {find}}));
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const {default: v1Router} = await import('../../routes/v1-router.js');
const {decodeCursor, encodeCursor} = await import('../../services/news-export-service.js');
const {MEMBER_LIST} = await import('../../services/utils/fifa-members.js');

const KEY = newApiKey();
process.env.API_KEYS = `friend:${hashOfKey(KEY)}`;
const app = express();
app.use('/api/v1', v1Router);

let server;
beforeAll(async () => { await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); }); });
afterAll(() => server.close());

const call = (query, {key = KEY} = {}) => new Promise((resolve, reject) => {
    const req = http.request({host: '127.0.0.1', port: server.address().port, path: `/api/v1/fifa/news${query ? `?${query}` : ''}`, method: 'GET', headers: key ? {Authorization: `Bearer ${key}`} : {}}, res => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { text += chunk; });
        res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: text === '' ? null : JSON.parse(text)}));
    });
    req.on('error', reject);
    req.end();
});

const MEMBER = MEMBER_LIST.find(member => member.level === 'association');

// a row as the model gives it
let nextId = 1;
const row = (more = {}) => {
    const id = nextId++;
    return {
        id, subject_qid: 'Q124138', subject_name: 'Gianni Infantino', member_qid: MEMBER.qid, certainty: 'established', uncertain_reason: '',
        stance: 'against', level: 'declared', mark: 'official', speaker_kind: 'president', speaker: 'A. President', matched: MEMBER.fifa,
        sentence: 'The association will not back him.', title: `Title ${id}`, description: '<p>The start of the <b>news</b>.</p>', quote: 'will not back him',
        lang: 'en', url: `https://example.org/fifa-${id}`, medium: 'example.org', published_at: new Date('2026-11-05T10:00:00Z'), news_count: 3, media_count: 2,
        read_by: ['gemma4:31b', 'deepseek-v4-pro'], created_at: new Date('2026-11-05T10:05:00Z'), seen: `2026-11-06T08:00:00.${String(id).padStart(6, '0')}Z`, ...more,
    };
};

beforeEach(() => {
    find.mockReset().mockResolvedValue([]);
});

describe('who and what is asked', () => {
    it('should need the key of a client, like the rest of /api/v1', async () => {
        expect((await call('', {key: null})).status).toBe(401);
        expect(find).not.toHaveBeenCalled();
    });

    it('should select what we select by default: the established passages and the uncertain ones, not the ones left out', async () => {
        const res = await call('');
        expect(res.status).toBe(200);
        expect(find).toHaveBeenCalledWith(expect.objectContaining({certainty: ['established', 'uncertain'], subjects: [], members: [], order: 'asc', limit: 50, after: null}));
    });

    it('should pass on what is asked: candidates, associations, certainty, the dates of the news, the order and the size of a page', async () => {
        await call('subject=Q124138,Q42&association=Q35572&certainty=discarded&since=2026-11-01&until=2026-11-08T00:00:00Z&order=desc&limit=7');
        expect(find).toHaveBeenCalledWith(expect.objectContaining({
            certainty: ['discarded'], subjects: ['Q124138', 'Q42'], members: ['Q35572'], since: '2026-11-01T00:00:00.000Z', until: '2026-11-08T00:00:00.000Z', order: 'desc', limit: 7,
        }));
    });

    it('should refuse what it does not understand with a 422 that names the parameter, and read nothing', async () => {
        const refused = [
            ['subject=Infantino', 'subject'], ['association=35572', 'association'], ['certainty=maybe', 'certainty'], ['limit=0', 'limit'], ['limit=201', 'limit'],
            ['order=up', 'order'], ['since=yesterday', 'since'], ['since=2026-11-08&until=2026-11-01', 'until'], ['cursor=garbage', 'cursor'], ['subject=Q1&subject=Q2', 'subject'],
        ];
        for (const [query, parameter] of refused) {
            const res = await call(query);
            expect(res.status).toBe(422);
            expect(res.body.error).toMatchObject({code: 'invalid_parameter', parameter});
        }
        expect(find).not.toHaveBeenCalled();
    });

    it('should accept at most 6 candidates (one colour each on the map) and 20 associations', async () => {
        expect((await call(`subject=${Array.from({length: 7}, (_, i) => `Q${i + 1}`).join(',')}`)).status).toBe(422);
        expect((await call(`association=${Array.from({length: 21}, (_, i) => `Q${i + 1}`).join(',')}`)).status).toBe(422);
        expect(find).not.toHaveBeenCalled();
    });
});

describe('what is given back', () => {
    it('should give the passage, how we read it and the news it is in', async () => {
        find.mockResolvedValue([row({id: 41, title: 'Title 41', url: 'https://example.org/fifa-41', seen: '2026-11-06T08:00:00.000041Z'})]);
        const res = await call('');
        expect(res.headers['cache-control']).toBe('private, max-age=60');
        expect(res.body.items).toEqual([{
            id: 41,
            updated_at: '2026-11-06T08:00:00.000041Z',
            subject: {qid: 'Q124138', name: 'Gianni Infantino'},
            association: {qid: MEMBER.qid, fifa: MEMBER.fifa, name: MEMBER.name, full_name: MEMBER.association ?? MEMBER.name, confederation: MEMBER.confederation ?? null, level: 'association'},
            certainty: 'established',
            uncertain_reason: null,
            reading: {stance: 'against', level: 'declared', mark: 'official', speaker_kind: 'president', speaker: 'A. President', quote: 'will not back him'},
            sentence: 'The association will not back him.',
            matched: MEMBER.fifa,
            news: {
                url: 'https://example.org/fifa-41', title: 'Title 41', description: 'The start of the news .', medium: 'example.org', lang: 'en',
                published_at: '2026-11-05T10:00:00.000Z', told_by: {news: 3, media: 2},
            },
        }]);
    });

    it('should say why a passage is only uncertain, and name an association it does not know by its item alone', async () => {
        find.mockResolvedValue([row({certainty: 'uncertain', uncertain_reason: 'readings_disagree', stance: 'none', level: 'none', speaker: '', quote: '', member_qid: 'Q999999999'})]);
        const [item] = (await call('')).body.items;
        expect(item.uncertain_reason).toBe('readings_disagree');
        expect(item.reading).toMatchObject({stance: 'none', speaker: null, quote: null});
        expect(item.association).toEqual({qid: 'Q999999999', fifa: null, name: null, full_name: null, confederation: null, level: null});
    });

    it('should never give a link that carries a secret or is one of our bridge, yet go on after it', async () => {
        const rows = [row({url: 'https://example.org/a?token=abc'}), row({url: 'https://user:pass@example.org/b'}), row({url: 'ftp://example.org/c'}), row()];
        find.mockResolvedValue(rows);
        const res = await call('');
        expect(res.body.items.map(item => item.id)).toEqual([rows[3].id]);
        expect(JSON.stringify(res.body)).not.toMatch(/token=|user:pass/);
    });

    it('should go on from the last passage read, shared or not, and say whether there is a next page', async () => {
        const rows = [row(), row(), row({url: 'https://example.org/z?key=secret'})];
        find.mockResolvedValue(rows);
        const res = await call('limit=2');
        expect(res.body.has_more).toBe(true);
        expect(res.body.items).toHaveLength(2);
        expect(decodeCursor(res.body.next_cursor)).toEqual({seen: rows[1].seen, id: rows[1].id});

        find.mockClear();
        await call(`cursor=${res.body.next_cursor}`);
        expect(find).toHaveBeenCalledWith(expect.objectContaining({after: {seen: rows[1].seen, id: rows[1].id}}));
    });

    it('should keep a cursor on the last page, for the client that comes back the next day, and none for an empty page', async () => {
        const last = row();
        find.mockResolvedValue([last]);
        const res = await call('');
        expect(res.body.has_more).toBe(false);
        expect(res.body.next_cursor).toBe(encodeCursor(last.seen, last.id));
        find.mockResolvedValue([]);
        expect((await call('')).body.next_cursor).toBeNull();
    });
});
