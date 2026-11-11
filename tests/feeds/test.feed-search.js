//
//  Author: Fabian Rostello
//  Date: 11.11.2026
//  File: test.feed-search.js
//  Description: The search by keywords asks Postgres for the text without its accents once the index of that text is built (db/add_plain_search.sql),
//               and with the accents in classes of letters before: a server started before the migration works as it did
//

import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';

const queryRawUnsafe = jest.fn();
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {$queryRawUnsafe: queryRawUnsafe}}));
const {FeedModel, forgetPlainSearch} = await import('../../models/feed-model.js');
const {Filter} = await import('../../services/utils/filter.js');

const search = (keywords = 'Zürich') => FeedModel.searchArticles({feedUrls: ['https://a.example/rss'], keywords: Filter.parse([keywords])});
// the SQL and parameters of the search itself: the call that is not the question about the index
const searchCall = () => queryRawUnsafe.mock.calls.find(([sql]) => sql.includes('FROM articles a'));
const indexQuestions = () => queryRawUnsafe.mock.calls.filter(([sql]) => sql.includes('pg_index'));

beforeEach(() => {
    queryRawUnsafe.mockReset();
    forgetPlainSearch();
    jest.useFakeTimers({now: new Date('2026-11-11T10:00:00Z')});
});
afterEach(() => jest.useRealTimers());

describe('searchArticles', () => {
    it('should keep the accents in classes of letters while the index of the text without accents is not built', async () => {
        queryRawUnsafe.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
        await search();
        const [sql, , , , pattern] = searchCall();
        expect(sql).toContain('a.search_text ~* $4');
        expect(sql).not.toContain('plain_text');
        expect(pattern).toBe('(^|[^[:alnum:]])Z[uùúûü]r[iìíîï][cç]h');
    });

    it('should search the text without its accents, the letters as they are, once the index is built', async () => {
        queryRawUnsafe.mockResolvedValueOnce([{'?column?': 1}]).mockResolvedValueOnce([]);
        await search();
        const [sql, , , , pattern] = searchCall();
        expect(sql).toContain('public.plain_text(a.search_text) ~* public.plain_text($4::text)');
        expect(pattern).toBe('(^|[^[:alnum:]])Zürich');
    });

    it('should ask about the index again after five minutes until it is built, then no more', async () => {
        queryRawUnsafe.mockResolvedValue([]);
        await search();
        await search();
        expect(indexQuestions()).toHaveLength(1);
        jest.advanceTimersByTime(5 * 60e3 + 1);
        queryRawUnsafe.mockImplementation(async (sql) => sql.includes('pg_index') ? [{'?column?': 1}] : []);
        await search();
        expect(indexQuestions()).toHaveLength(2);
        expect(queryRawUnsafe.mock.calls.at(-1)[0]).toContain('public.plain_text(a.search_text)');
        jest.advanceTimersByTime(24 * 3600e3);
        await search();
        expect(indexQuestions()).toHaveLength(2);
    });

    it('should search as before when the question about the index fails, and ask nothing for no keyword', async () => {
        queryRawUnsafe.mockRejectedValueOnce(new Error('no pg_index for you')).mockResolvedValueOnce([]);
        await search();
        expect(searchCall()[0]).toContain('a.search_text ~* $4');
        queryRawUnsafe.mockReset();
        expect(await FeedModel.searchArticles({feedUrls: [], keywords: Filter.parse([''])})).toEqual([]);
        expect(searchCall()).toBeUndefined();
    });
});
