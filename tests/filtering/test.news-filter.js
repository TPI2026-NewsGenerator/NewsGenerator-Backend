//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: test.news-filter.js
//  Description: Tests for news filtering (keywords parsed in JS, matched in Postgres)
//

import process from 'node:process'
import 'dotenv/config';
import pg from 'pg';
import {Filter} from '../../services/utils/filter.js'

describe('Filter.parse', () => {
    it('should return nothing for empty keywords', () => {
        expect(Filter.parse([''])).toEqual({groups: [], excluded: []});
        expect(Filter.parse([' , '])).toEqual({groups: [], excluded: []});
        expect(Filter.parse(['""'])).toEqual({groups: [], excluded: []});
        expect(Filter.parse(undefined)).toEqual({groups: [], excluded: []});
    });

    it('should split alternatives on commas', () => {
        expect(Filter.parse(['climat, tech']).groups).toEqual([
            [{text: 'climat', exact: false}],
            [{text: 'tech', exact: false}],
        ]);
    });

    it('should keep the words of an alternative together', () => {
        expect(Filter.parse(['red card']).groups).toEqual([
            [{text: 'red', exact: false}, {text: 'card', exact: false}],
        ]);
    });

    it('should read quoted phrases, with commas inside', () => {
        expect(Filter.parse(['"red, card" referee']).groups).toEqual([
            [{text: 'red, card', exact: true}, {text: 'referee', exact: false}],
        ]);
    });

    it('should read an unclosed quote until the end', () => {
        expect(Filter.parse(['"red card']).groups).toEqual([[{text: 'red card', exact: true}]]);
    });

    it('should read the excluded terms (-word and -"phrase")', () => {
        expect(Filter.parse(['referee -rugby -"red card"'])).toEqual({
            groups: [[{text: 'referee', exact: false}]],
            excluded: [{text: 'rugby', exact: false}, {text: 'red card', exact: true}],
        });
    });

    it('should keep a hyphen inside a word', () => {
        expect(Filter.parse(['e-sport']).groups).toEqual([[{text: 'e-sport', exact: false}]]);
    });
});

describe('Filter.toPattern', () => {
    it('should escape regex characters', () => {
        expect(Filter.toPattern({text: 'c++', exact: false})).toBe('(^|[^[:alnum:]])c\\+\\+([^[:alnum:]]|$)');
    });

    it('should need a whole word for short words and exact terms only', () => {
        expect(Filter.toPattern({text: 'var', exact: false})).toMatch(/\|\$\)$/);
        expect(Filter.toPattern({text: 'referee', exact: false})).toBe('(^|[^[:alnum:]])referee');
        expect(Filter.toPattern({text: 'referee', exact: true})).toBe('(^|[^[:alnum:]])referee([^[:alnum:]]|$)');
    });
});

// the matching runs in Postgres (regex ~* on articles.search_text), so it is tested there
// with the same function as the table: article_search_text (db/add_articles_search.sql)
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
let dbAvailable = true;
try {
    await pool.query('SELECT public.article_search_text($1, $2, $3::text[])', ['', '', []]);
} catch {
    dbAvailable = false;
    console.warn('Database or article_search_text() not available, the Postgres filter tests are skipped');
}
afterAll(() => pool.end());

// titles of the news matching the keywords, in the order of newsList
const titles = async (newsList, keywords) => {
    const parsed = Filter.parse(keywords);

    const values = [];
    const rows = newsList.map((news, i) => {
        values.push(i, news.title, news.description ?? '', news.category ?? []);
        const n = values.length - 3;
        return `($${n}::int, $${n + 1}::text, $${n + 2}::text, $${n + 3}::text[])`;
    });
    const keywordsSql = Filter.keywordsSql(parsed, values.length + 1, 'search_text');
    if (!keywordsSql) return [];

    const {rows: found} = await pool.query(`
        SELECT title FROM (
            SELECT t.position, t.title, public.article_search_text(t.title, t.description, t.category) AS search_text
            FROM (VALUES ${rows.join(', ')}) AS t(position, title, description, category)
        ) AS s
        WHERE ${keywordsSql.sql}
        ORDER BY position`,
        [...values, ...keywordsSql.params]);

    return found.map(row => row.title);
};

(dbAvailable ? describe : describe.skip)('Filter in Postgres', () => {
    const mockNewsList = [
        { title: 'Le climat se réchauffe', category: ['Environnement'] },
        { title: 'Nouveau record au 100m', category: ['Sport', 'Athlétisme'] },
        { title: 'La tech en 2024', category: ['Technologie'] },
    ];

    it('should return nothing if keywords are empty', async () => {
        expect(await titles(mockNewsList, [''])).toEqual([]);
    });

    it('should filter by title', async () => {
        expect(await titles(mockNewsList, ['climat'])).toEqual(['Le climat se réchauffe']);
    });

    it('should filter by category', async () => {
        expect(await titles(mockNewsList, ['Environnement'])).toEqual(['Le climat se réchauffe']);
        expect(await titles(mockNewsList, ['Sport'])).toEqual(['Nouveau record au 100m']);
    });

    it('should be case insensitive', async () => {
        expect(await titles(mockNewsList, ['CLIMAT'])).toEqual(['Le climat se réchauffe']);
    });

    it('should filter by title when the news has no category', async () => {
        const newsList = [{ title: 'Referee under fire after VAR decision' }, { title: 'Club signs new striker' }];
        expect(await titles(newsList, ['referee'])).toEqual(['Referee under fire after VAR decision']);
    });

    it('should split keywords separated by commas', async () => {
        expect(await titles(mockNewsList, ['climat, tech'])).toEqual(['Le climat se réchauffe', 'La tech en 2024']);
    });

    it('should return each news once even if several keywords match', async () => {
        expect(await titles(mockNewsList, ['climat', 'environnement', 'réchauffe'])).toHaveLength(1);
    });

    it('should match the start of a word only', async () => {
        const newsList = [
            { title: 'Referees under fire' },
            { title: 'Comedy refereeing in Buenos Aires' },
            { title: 'Canelo Alvarez wins again' },
        ];
        expect(await titles(newsList, ['referee'])).toHaveLength(2);
        expect(await titles(newsList, ['varez'])).toEqual([]);
    });

    it('should match short keywords (acronyms) as a whole word', async () => {
        const newsList = [
            { title: 'Howard Webb defends VAR decision' },
            { title: 'Top 10 variations for chest' },
            { title: 'Navarrete vs Valdez' },
        ];
        expect(await titles(newsList, ['var'])).toEqual(['Howard Webb defends VAR decision']);
    });

    it('should work with accents and special characters', async () => {
        expect(await titles(mockNewsList, ['réchauffe'])).toHaveLength(1);
        expect(await titles([{ title: 'La préchauffe du four' }], ['réchauffe'])).toEqual([]);
        expect(await titles([{ title: 'C++ is 40 years old' }], ['c++'])).toHaveLength(1);
    });

    describe('description and Google-like keywords', () => {
        const newsList = [
            { title: 'Referee under fire', description: '<p>The <b>red card</b> was wrong</p>' },
            { title: 'Referees meet in London' },
            { title: 'Card red for the player', description: 'VAR checked the action' },
        ];

        it('should search in the description, without the HTML tags', async () => {
            expect(await titles(newsList, ['checked'])).toEqual(['Card red for the player']);
            expect(await titles(newsList, ['b'])).toEqual([]);
        });

        it('should find word variants without quotes', async () => {
            expect(await titles(newsList, ['referee'])).toEqual(['Referee under fire', 'Referees meet in London']);
        });

        it('should find the exact word with quotes', async () => {
            expect(await titles(newsList, ['"referee"'])).toEqual(['Referee under fire']);
        });

        it('should find the exact phrase with quotes, words in this order', async () => {
            expect(await titles(newsList, ['"red card"'])).toEqual(['Referee under fire']);
        });

        it('should not find a phrase split between the title and the description', async () => {
            expect(await titles(newsList, ['"fire the"'])).toEqual([]);
        });

        it('should find all the words in any order without quotes', async () => {
            expect(await titles(newsList, ['red card'])).toEqual(['Referee under fire', 'Card red for the player']);
            expect(await titles(newsList, ['red london'])).toEqual([]);
        });

        it('should mix exact phrases and words, all needed', async () => {
            expect(await titles(newsList, ['"red card" referee'])).toEqual(['Referee under fire']);
            expect(await titles(newsList, ['"red card" london'])).toEqual([]);
        });

        it('should keep commas inside quotes', async () => {
            expect(await titles(newsList, ['"red, card"'])).toEqual([]);
            expect(await titles(newsList, ['london, "red card"'])).toEqual(['Referee under fire', 'Referees meet in London']);
        });

        it('should treat SQL in keywords as plain text', async () => {
            expect(await titles(newsList, ["'); DROP TABLE articles; --"])).toEqual([]);
        });
    });
});
