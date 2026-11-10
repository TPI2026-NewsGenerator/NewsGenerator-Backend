//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: test.news-export.js
//  Description: GET /api/v1/news, the news that name a person and/or an association for the system of another party: what
//               is asked is checked (a refusal names the parameter, and nothing is read), what is asked of the database
//               (a country is its associations, the words are one regex, the next page goes on from a cursor), and what is given back (the
//               news as they are, why each was found, the stories, never a link that carries a secret). The database is not
//               here: the model is a double that answers what the SQL would
//

import http from 'node:http';
import process from 'node:process';
import {afterAll, beforeAll, beforeEach, describe, expect, it, jest} from '@jest/globals';
import express from 'express';
import {hashOfKey, newApiKey} from '../../services/utils/api-key.js';

const find = jest.fn();
const storiesOf = jest.fn(async () => []);
const entitiesOf = jest.fn(async () => []);
const linkedAmong = jest.fn(async () => []);
jest.unstable_mockModule('../../models/news-export-model.js', () => ({NewsExportModel: {find, storiesOf, entitiesOf, linkedAmong}}));
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const {default: v1Router} = await import('../../routes/v1-router.js');
const {cleanText, decodeCursor, encodeCursor, isShareable, regexesOfTerms} = await import('../../services/news-export-service.js');
const {associationsOfCountry} = await import('../../services/utils/football-associations.js');

const KEY = newApiKey();
process.env.API_KEYS = `friend:${hashOfKey(KEY)}`;
const app = express();
app.use('/api/v1', v1Router);

let server;
beforeAll(async () => { await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); }); });
afterAll(() => server.close());

const call = (query, {key = KEY, path = '/news'} = {}) => new Promise((resolve, reject) => {
    const req = http.request({host: '127.0.0.1', port: server.address().port, path: `/api/v1${path}${query ? `?${query}` : ''}`, method: 'GET', headers: key ? {Authorization: `Bearer ${key}`} : {}}, res => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { text += chunk; });
        res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: text === '' ? null : JSON.parse(text)}));
    });
    req.on('error', reject);
    req.end();
});

// a row as the model gives it
let nextId = 100;
const row = (more = {}) => {
    const id = nextId++;
    return {
        id, link: `https://example.org/news-${id}`, title: `Title ${id}`, description: `Description of the news ${id}, long enough to be a text.`,
        lang: 'en', published_at: new Date('2026-11-05T10:00:00Z'), created_at: new Date('2026-11-05T10:05:00Z'),
        id_story: null, medium: 'example.org', seen: `2026-11-05T10:05:00.${String(id).padStart(6, '0')}Z`, ...more,
    };
};

beforeEach(() => {
    find.mockReset().mockResolvedValue([]);
    storiesOf.mockReset().mockResolvedValue([]);
    entitiesOf.mockReset().mockResolvedValue([]);
    linkedAmong.mockReset().mockResolvedValue([]);
});

describe('who and what is asked', () => {
    it('should need the key of a client, like the rest of /api/v1', async () => {
        expect((await call('person=Q124138', {key: null})).status).toBe(401);
        expect(find).not.toHaveBeenCalled();
    });

    it('should refuse to give the whole base: a person, words or an association is asked', async () => {
        for (const query of ['', 'lang=en', 'limit=10', 'has_text=true&order=desc']) {
            const res = await call(query);
            expect(res.status).toBe(422);
            expect(res.body.error).toMatchObject({code: 'missing_filter', message: expect.stringContaining('person, q, association or country')});
        }
        expect(find).not.toHaveBeenCalled();
    });

    it('should refuse what is not the shape asked, naming the parameter, and read nothing', async () => {
        const refusals = [
            ['person=infantino', 'person'], ['person=Q0', 'person'], ['person=Q1,Q2,Q3,Q4,Q5,Q6', 'person'], ['person=Q1&person=Q2', 'person'],
            ['association=Q12,xyz', 'association'], ['q=abc', 'q'], [`q=${'x'.repeat(41)}`, 'q'],
            ['person=Q1&country=J', 'country'], ['person=Q1&country=JPN', 'country'], ['person=Q1&country=ZZ', 'country'],
            ['person=Q1&lang=english', 'lang'], ['person=Q1&medium=not%20a%20domain', 'medium'], ['person=Q1&exclude_medium=-x', 'exclude_medium'],
            ['person=Q1&since=yesterday', 'since'], ['person=Q1&since=2026-02-30', 'since'], ['person=Q1&until=2026-11-01T08:30:00', 'until'],
            ['person=Q1&since=2026-11-02&until=2026-11-01', 'until'], ['person=Q1&has_text=yes', 'has_text'], ['person=Q1&dedupe=media', 'dedupe'],
            ['person=Q1&order=random', 'order'], ['person=Q1&limit=0', 'limit'], ['person=Q1&limit=201', 'limit'], ['person=Q1&limit=ten', 'limit'],
            ['person=Q1&include=everything', 'include'], ['person=Q1&cursor=not-a-cursor', 'cursor'],
        ];
        for (const [query, parameter] of refusals) {
            const res = await call(query);
            expect({query, status: res.status, parameter: res.body.error?.parameter}).toEqual({query, status: 422, parameter});
        }
        expect(find).not.toHaveBeenCalled();
    });

    it('should refuse a word in a script the index does not serve when it is alone, and say what to ask (a scan of every news takes 40 s)', async () => {
        for (const word of ['インファンティーノ', '因凡蒂诺', '인판티노', 'อินฟานติโน']) {
            const res = await call(`q=${encodeURIComponent(word)}`);
            expect(res.status).toBe(422);
            expect(res.body.error).toMatchObject({code: 'unsupported_script', parameter: 'q', message: expect.stringContaining('association= or country=')});
            expect(res.body.error.message).toContain('person=Q');
        }
        // a person asked as well does not make it a smaller search
        expect((await call(`person=Q124138&q=${encodeURIComponent('因凡蒂诺')}`)).status).toBe(422);
        expect(find).not.toHaveBeenCalled();
    });

    it('should read such a word in the news of an association asked, and give it to the model apart from the words the index serves', async () => {
        await call(`q=${encodeURIComponent('インファンティーノ,infantino')}&country=JP`);
        expect(find).toHaveBeenCalledTimes(1);
        expect(find.mock.calls[0][0]).toMatchObject({terms: ['\\m(infantino)\\M'], scanTerms: ['インファンティーノ'], associations: ['Q579842']});
        find.mockClear();
        // two characters are enough in these scripts, where a name is short; not in the others
        expect((await call(`q=${encodeURIComponent('因凡')}&association=Q579842`)).status).toBe(200);
        expect((await call(`q=${encodeURIComponent('因')}&association=Q579842`)).status).toBe(422);
    });

    it('should tell which words of another script a news holds, as they are written', async () => {
        find.mockResolvedValueOnce([row({id: 3, title: 'インファンティーノ会長がJFAを訪問', description: 'ジャンニ・インファンティーノ氏は…'})]);
        const res = await call(`q=${encodeURIComponent('インファンティーノ,因凡蒂诺')}&country=JP`);
        expect(res.body.items[0].matched.terms).toEqual(['インファンティーノ']);
    });

    it('should take words in the scripts that are served, accents and apostrophes included', async () => {
        for (const word of ['Инфантино', 'إنفانتينو', 'Ινφαντίνο', 'אינפנטינו', 'Arsène Wenger', "N'Golo Kanté"]) {
            expect((await call(`q=${encodeURIComponent(word)}`)).status).toBe(200);
        }
    });

    it('should name the codes of a country that has no association, and read nothing', async () => {
        const res = await call('country=AQ');
        expect(res.status).toBe(422);
        expect(res.body.error).toMatchObject({parameter: 'country', message: expect.stringContaining('AQ')});
        expect(find).not.toHaveBeenCalled();
    });
});

describe('what is asked of the database', () => {
    it('should ask for the person, the words as one regex of words on their own, and the defaults', async () => {
        await call(`person=Q124138&q=${encodeURIComponent('infantino,Arsène')}`);
        expect(find).toHaveBeenCalledTimes(1);
        const filters = find.mock.calls[0][0];
        expect(filters).toMatchObject({persons: ['Q124138'], associations: [], langs: [], media: [], excludedMedia: [], since: null, until: null, hasText: false, dedupe: null, order: 'asc', after: null, limit: 50});
        // one regex a word, searched apart, each with its form without accents: "Arsène" finds "Arsene"
        expect(filters.terms).toEqual(['\\m(infantino)\\M', '\\m(Arsène|Arsene)\\M']);
    });

    it('should turn a country into its associations, with the ones asked, once each', async () => {
        await call('association=Q579842,Q9500&country=JP');
        expect(find.mock.calls[0][0].associations.sort()).toEqual(['Q579842', 'Q9500']);
        find.mockClear();
        await call('country=jp');
        expect(find.mock.calls[0][0].associations).toEqual(['Q579842']);
    });

    it('should give a country the associations of its own, a nation of the United Kingdom apart, and GB the four', async () => {
        expect(associationsOfCountry('JP').map(item => item.name)).toEqual(['Japan Football Association']);
        expect(associationsOfCountry('GB-WLS').map(item => item.name)).toEqual(['Football Association of Wales']);
        expect(associationsOfCountry('GB').map(item => item.country).sort()).toEqual(['GB-ENG', 'GB-NIR', 'GB-SCT', 'GB-WLS']);
        // a territory is not of the state it depends on
        expect(associationsOfCountry('BM').map(item => item.name)).toEqual(['Bermuda Football Association']);
        expect(associationsOfCountry('FR').map(item => item.name)).toEqual(['French Football Federation']);
        // a confederation is of no country
        expect(associationsOfCountry('CH').map(item => item.name)).toEqual(['Swiss Football Association']);
        expect(associationsOfCountry('AQ')).toEqual([]);
    });

    it('should pass the other filters as they were asked', async () => {
        await call('person=Q1&lang=en,fr&medium=bbc.co.uk&exclude_medium=Google.com&since=2026-11-01&until=2026-11-08T12:00:00%2B01:00&has_text=true&dedupe=story&order=desc&limit=20');
        expect(find.mock.calls[0][0]).toMatchObject({
            langs: ['en', 'fr'], media: ['bbc.co.uk'], excludedMedia: ['google.com'],
            since: '2026-11-01T00:00:00.000Z', until: '2026-11-08T11:00:00.000Z', hasText: true, dedupe: 'story', order: 'desc', limit: 20,
        });
    });

    it('should ask one row more than the limit to know whether there is a next page, and still give the cursor of the last news on the last page', async () => {
        const rows = [row(), row()];
        find.mockResolvedValueOnce(rows);
        const res = await call('person=Q1&limit=5');
        expect(find.mock.calls[0][0].limit).toBe(5);
        expect(res.body).toMatchObject({has_more: false, retention_days: 30, order: 'asc'});
        expect(res.body.items).toHaveLength(2);
        // what a client that follows the news keeps, to ask the next day for what came since
        expect(decodeCursor(res.body.next_cursor)).toEqual({seen: rows[1].seen, id: rows[1].id});
    });

    it('should give no cursor for a page with nothing in it: the client keeps the one it has', async () => {
        const res = await call('person=Q1');
        expect(res.body).toMatchObject({items: [], has_more: false, next_cursor: null});
    });

    it('should cut the page at the limit and give the cursor of its last news when there is more', async () => {
        const rows = [row(), row(), row()];
        find.mockResolvedValueOnce(rows);
        const res = await call('person=Q1&limit=2');
        expect(res.body.items.map(item => item.id)).toEqual([rows[0].id, rows[1].id]);
        expect(res.body.has_more).toBe(true);
        expect(decodeCursor(res.body.next_cursor)).toEqual({seen: rows[1].seen, id: rows[1].id});
    });

    it('should go on from a cursor in the order asked, and take none that was not given', async () => {
        const cursor = encodeCursor('2026-11-05T10:05:00.000123Z', 77);
        await call(`person=Q1&cursor=${cursor}`);
        expect(find.mock.calls[0][0].after).toEqual({seen: '2026-11-05T10:05:00.000123Z', id: 77});
        expect(decodeCursor('')).toBeNull();
        expect(decodeCursor(Buffer.from('2026-11-05|77').toString('base64url'))).toBeNull();
        expect(decodeCursor(Buffer.from('2026-11-05T10:05:00.000123Z|1; DROP TABLE articles').toString('base64url'))).toBeNull();
    });

    it('should answer with a failure of the database as an error of ours that tells nothing of what went wrong', async () => {
        const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
        find.mockRejectedValueOnce(new Error('connection to 192.168.1.135:5433 refused'));
        const res = await call('person=Q1');
        expect(res.status).toBe(500);
        expect(res.body.error).toEqual({code: 'server_error', message: 'The request could not be answered right now.'});
        expect(JSON.stringify(res.body)).not.toContain('192.168');
        expect(logged).toHaveBeenCalled();
        logged.mockRestore();
    });
});

describe('what is given back', () => {
    it('should give a news as it is, with the time it was seen, the story it is of and why it was found', async () => {
        const news = row({id: 5, title: 'FAW boss renews call for Infantino to step down', id_story: 900, lang: 'en', medium: 'bbc.co.uk', link: 'https://www.bbc.co.uk/sport/football/articles/abc'});
        find.mockResolvedValueOnce([news]);
        storiesOf.mockResolvedValueOnce([{id: 900, size: 17, media: 9}]);
        linkedAmong.mockResolvedValueOnce([{id: 5, qid: 'Q124138'}, {id: 5, qid: 'Q275173'}, {id: 5, qid: 'Q999'}]);
        const res = await call('person=Q124138&association=Q275173&q=infantino,wenger');
        expect(res.body.items).toEqual([{
            id: 5, title: 'FAW boss renews call for Infantino to step down', description: news.description,
            url: 'https://www.bbc.co.uk/sport/football/articles/abc', medium: 'bbc.co.uk', lang: 'en',
            published_at: '2026-11-05T10:00:00.000Z', seen_at: '2026-11-05T10:05:00.000Z',
            story: {id: 900, size: 17, media: 9},
            // the items of Wikidata asked that the tagger linked, the words asked that are in it: Q999 was not asked
            matched: {person: ['Q124138'], association: ['Q275173'], terms: ['infantino']},
        }]);
        expect(storiesOf).toHaveBeenCalledWith([900]);
        expect(linkedAmong).toHaveBeenCalledWith([5], ['Q124138', 'Q275173']);
    });

    it('should give no story to a news the grouping has not joined, and no date it has not', async () => {
        find.mockResolvedValueOnce([row({id_story: null, published_at: null})]);
        const [item] = (await call('person=Q1')).body.items;
        expect(item.story).toBeNull();
        expect(item.published_at).toBeNull();
    });

    it('should give the names the tagger found, only when asked, and the marks of the words, only when asked', async () => {
        const news = row({id: 8, title: 'FIFA denies it: "we will not comment", the federation said in a statement', lang: 'en', description: 'The federation reportedly said so.'});
        find.mockResolvedValue([news]);
        entitiesOf.mockResolvedValue([{id: 8, name: 'FIFA', kind: 'organization', qid: 'Q253414'}, {id: 8, name: 'Zurich', kind: 'location', qid: null}]);
        const plain = (await call('person=Q1')).body.items[0];
        expect(plain).not.toHaveProperty('entities');
        expect(plain).not.toHaveProperty('marks');
        expect(entitiesOf).not.toHaveBeenCalled();
        const rich = (await call('person=Q1&include=entities,marks')).body.items[0];
        expect(rich.entities).toEqual([{name: 'FIFA', kind: 'organization', qid: 'Q253414'}, {name: 'Zurich', kind: 'location', qid: null}]);
        expect(rich.marks).toEqual({statement: true, denial: true, hedged: 'reportedly'});
    });

    it('should leave out a link that carries a secret, or is the address of our bridge, and go on from the last news read all the same', async () => {
        process.env.RSS_BRIDGE_URL = 'http://192.168.1.135:3002';
        const rows = [
            row({link: 'https://example.org/a?token=abc123'}),
            row({link: 'https://user:pass@example.org/b'}),
            row({link: 'http://192.168.1.135:3002/?action=display&bridge=Goal'}),
            row({link: 'https://example.org/public-article'}),
            row({link: 'https://news.google.com/rss/articles/CBMisgFBVV95cUxOdkR5d2pCNi02cXpNaVFiUmRFUXI3WnlZNnFkWkF1c1RuOU5HcUE2YzFI?oc=5'}),
        ];
        find.mockResolvedValueOnce([...rows, row()]);
        const res = await call('person=Q1&limit=5');
        expect(res.body.items.map(item => item.url)).toEqual([rows[3].link, rows[4].link]);
        expect(JSON.stringify(res.body)).not.toMatch(/token=|user:pass|192\.168/);
        // the next page goes on from the last news read, the one of the bridge or of a secret included, not from the last given
        expect(decodeCursor(res.body.next_cursor).id).toBe(rows[4].id);
        delete process.env.RSS_BRIDGE_URL;
    });

    it('should not read the stories, the names or the items of what was left out', async () => {
        find.mockResolvedValueOnce([row({id: 1, link: 'https://example.org/a?api_key=1', id_story: 5}), row({id: 2, id_story: 6})]);
        await call('person=Q1&include=entities');
        expect(storiesOf).toHaveBeenCalledWith([6]);
        expect(entitiesOf).toHaveBeenCalledWith([2]);
        expect(linkedAmong).toHaveBeenCalledWith([2], ['Q1']);
    });
});

describe('the helpers', () => {
    it('should keep a text without its tags, its entities and its blanks, and cut a long one at a word', () => {
        expect(cleanText('<p>Hello&nbsp;<b>world</b> &amp; &quot;all&quot;</p>\n\n  <a href="x">link</a>')).toBe('Hello world & "all" link');
        expect(cleanText(null)).toBe('');
        const long = cleanText(`${'word '.repeat(600)}end`);
        expect(long.length).toBeLessThanOrEqual(1502);
        expect(long.endsWith(' …')).toBe(true);
    });

    it('should turn each word into a regex of a word on its own, with its form without accents', () => {
        expect(regexesOfTerms([])).toEqual([]);
        expect(regexesOfTerms(['Vega'])).toEqual(['\\m(Vega)\\M']);
        expect(regexesOfTerms(['N.Golo (Kanté)', 'Vega'])).toEqual(['\\m(N\\.Golo \\(Kanté\\)|N\\.Golo \\(Kante\\))\\M', '\\m(Vega)\\M']);
    });

    it('should tell a link that may be given from one that may not', () => {
        for (const link of ['https://www.bbc.co.uk/sport/articles/c9d8f7e6', 'http://example.org/a-long-slug-with-2026-numbers-4f9b2c7d1e8a3b5c', 'https://news.google.com/rss/articles/CBMi0123456789abcdefghijklmnop?oc=5', 'https://example.org/a?page=2&utm_source=x']) {
            expect(isShareable(link)).toBe(true);
        }
        for (const link of ['https://example.org/a?token=x', 'https://example.org/a?API_KEY=x', 'https://example.org/a?sig=1', 'https://u:p@example.org/', 'ftp://example.org/a', 'javascript:alert(1)', 'not a url', '']) {
            expect(isShareable(link)).toBe(false);
        }
    });
});

describe('the positions set aside', () => {
    it('should not be served unless V1_POSITIONS_MOCK is on: a deploy shows nothing made up', async () => {
        // a key of its own: the tests above have used the 60 requests a minute of the first
        const fresh = newApiKey();
        process.env.API_KEYS = `${process.env.API_KEYS},fresh:${hashOfKey(fresh)}`;
        for (const path of ['/subjects', '/positions?subject=Q124138', '/positions/XXA', '/positions/changes?subject=Q124138&since=2026-11-01']) {
            const res = await call('', {path, key: fresh});
            expect({path, status: res.status, code: res.body.error.code}).toEqual({path, status: 404, code: 'not_found'});
        }
    });
});
