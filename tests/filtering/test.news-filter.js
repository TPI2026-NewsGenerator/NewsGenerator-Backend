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
        expect(Filter.toPattern({text: 'c++', exact: false})).toBe('(^|[^[:alnum:]])[cç]\\+\\+([^[:alnum:]]|$)');
    });

    it('should need a whole word for short words and exact terms only', () => {
        expect(Filter.toPattern({text: 'var', exact: false})).toMatch(/\|\$\)$/);
        expect(Filter.toPattern({text: 'ref', exact: false})).toBe('(^|[^[:alnum:]])r[eèéêë]f([^[:alnum:]]|$)');
        expect(Filter.toPattern({text: 'referee', exact: false})).not.toMatch(/\|\$\)$/);
        expect(Filter.toPattern({text: 'referee', exact: true})).toMatch(/\|\$\)$/);
    });

    it('should make short words in capitals (acronyms) case-sensitive only', () => {
        expect(Filter.toPattern({text: 'AI', exact: false})).toBe('(?c)(^|[^[:alnum:]])[AÀÁÂÃÄÅ][IÌÍÎÏ]([^[:alnum:]]|$)');
        expect(Filter.toPattern({text: 'NFL', exact: true})).toMatch(/^\(\?c\)/);
        expect(Filter.toPattern({text: 'ai', exact: false})).not.toMatch(/^\(\?c\)/);
        expect(Filter.toPattern({text: 'Var', exact: false})).not.toMatch(/^\(\?c\)/);
        expect(Filter.toPattern({text: 'NASA', exact: false})).not.toMatch(/^\(\?c\)/);
        expect(Filter.toPattern({text: '100', exact: false})).not.toMatch(/^\(\?c\)/);
    });

    it('should search a Latin letter with and without its accents, and the other scripts as written', () => {
        expect(Filter.toPattern({text: 'Barça', exact: false})).toBe('(^|[^[:alnum:]])B[aàáâãäå]r[cç][aàáâãäå]');
        expect(Filter.toPattern({text: 'Ολυμπιακός', exact: false})).toBe('(^|[^[:alnum:]])Ολυμπιακός');
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

    describe('acronyms in capitals', () => {
        const newsList = [
            { title: 'OpenAI ships a new AI model' },
            { title: "J'ai testé le Mac mini M4" },
            { title: "Je n'ai jamais organisé de mariage" },
            { title: 'Heat wave in Miami' },
            { title: "L'IA générative au travail" },
        ];

        it('should find an acronym in capitals, not the same letters in lowercase', async () => {
            expect(await titles(newsList, ['AI'])).toEqual(['OpenAI ships a new AI model']);
        });

        it('should still find it in an alternative and next to an apostrophe', async () => {
            expect(await titles(newsList, ['IA, AI'])).toEqual(['OpenAI ships a new AI model', "L'IA générative au travail"]);
        });

        it('should keep a short word in lowercase case-insensitive, as asked', async () => {
            expect(await titles(newsList, ['ai'])).toEqual([
                'OpenAI ships a new AI model', "J'ai testé le Mac mini M4", "Je n'ai jamais organisé de mariage",
            ]);
        });

        it('should also exclude an acronym in capitals only', async () => {
            expect(await titles(newsList, ['mac, mariage, model -AI'])).toEqual([
                "J'ai testé le Mac mini M4", "Je n'ai jamais organisé de mariage",
            ]);
        });
    });

    it('should work with accents and special characters', async () => {
        expect(await titles(mockNewsList, ['réchauffe'])).toHaveLength(1);
        expect(await titles([{ title: 'La préchauffe du four' }], ['réchauffe'])).toEqual([]);
        expect(await titles([{ title: 'C++ is 40 years old' }], ['c++'])).toHaveLength(1);
    });

    it('should find and exclude a word with or without its accents', async () => {
        const news = [{title: 'Le Barça répond'}, {title: 'Barca: the answer'}, {title: 'Zurich vote'}];
        expect(await titles(news, ['barca'])).toEqual(['Le Barça répond', 'Barca: the answer']);
        expect(await titles(news, ['zürich'])).toEqual(['Zurich vote']);
        expect(await titles(news, ['vote, answer -Barça'])).toEqual(['Zurich vote']);
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

describe('Filter.canWiden and Filter.widen', () => {
    it('should see that a search asking for several words at once can be widened', () => {
        expect(Filter.canWiden(Filter.parse(['referee football soccer']))).toBe(true);
        expect(Filter.canWiden(Filter.parse(['referee']))).toBe(false);
        expect(Filter.canWiden(Filter.parse(['referee, football']))).toBe(false);
    });

    it('should turn "all of them" into "any of them", keeping what was excluded', () => {
        const wider = Filter.widen(Filter.parse(['referee football -rugby']));

        expect(wider.groups.map(terms => terms.map(term => term.text))).toEqual([['referee'], ['football']]);
        expect(wider.excluded.map(term => term.text)).toEqual(['rugby']);
    });

    it('should keep an exact phrase whole, it was asked for on purpose', () => {
        const wider = Filter.widen(Filter.parse(['"red card" referee']));

        expect(wider.groups.map(terms => terms.map(term => term.text))).toEqual([['red card'], ['referee']]);
        expect(wider.groups[0][0].exact).toBe(true);
    });
});

describe('Filter.matcher', () => {
    const matches = (keywords, text) => Filter.matcher(Filter.parse(keywords))(text);

    it('should read the keywords like the SQL filter: alternatives, all the terms, exclusions', () => {
        expect(matches(['rugby, fashion'], 'London Fashion Week')).toBe(true);
        expect(matches(['Top 14'], 'Top 14 - Vannes perd encore')).toBe(true);
        expect(matches(['Top 14'], 'Le top 140 des séries')).toBe(false);
        expect(matches(['chien -chaud'], 'Un chien sauvé')).toBe(true);
        expect(matches(['chien -chaud'], 'Chien chaud au menu')).toBe(false);
    });

    it('should find the variants of a word but not a short word inside another', () => {
        expect(matches(['chien'], 'Les chiens et la chaleur')).toBe(true);
        expect(matches(['vet'], 'Un vétérinaire explique')).toBe(false);
    });

    it('should ignore the accents and the case, except for an acronym', () => {
        expect(matches(['défilé'], 'DEFILE Marni')).toBe(true);
        expect(matches(['AI'], "J'ai vu le match")).toBe(false);
        expect(matches(['AI'], 'A new AI model')).toBe(true);
    });

    it('should not take an acronym in a title shouted in capitals, but one beside another acronym', () => {
        expect(matches(['"VAR"'], 'LA VALETTE-DU-VAR : Octobre Rose, les associations se mobilisent')).toBe(false);
        expect(matches(['"VAR"'], 'LA VALETTE-DU-VAR : Octobre Rose. Le VAR divise les arbitres')).toBe(true);
        expect(matches(['"VAR"'], 'Neue VAR-Linie zeigt Wirkung')).toBe(true);
        expect(matches(['"VAR"'], "L'UEFA VAR sous pression")).toBe(true);
        expect(matches(['"VAR"'], 'Le Var sous la pluie')).toBe(false);
    });

    it('should match nothing without keywords', () => {
        expect(Filter.matcher(Filter.parse(['']))).toBeNull();
    });
});

describe('Filter.hasOperators', () => {
    it('should search a sentence by its meaning', () => {
        expect(Filter.hasOperators(['les nouvelles règles des trottinettes à Paris'])).toBe(false);
        expect(Filter.hasOperators(['Mbappé blessure'])).toBe(false);
        // a dash inside a word is no exclusion
        expect(Filter.hasOperators(['la Haute-Savoie après les orages'])).toBe(false);
    });

    it('should keep exact words when the reader wrote an operator', () => {
        expect(Filter.hasOperators(['"red card"'])).toBe(true);
        expect(Filter.hasOperators(['referee, VAR'])).toBe(true);
        expect(Filter.hasOperators(['referee -rugby'])).toBe(true);
        expect(Filter.hasOperators(['-"red card"'])).toBe(true);
    });
});

describe('Filter.highlights', () => {
    const marked = (text, terms) => Filter.highlights(text, terms).map(([start, end]) => text.slice(start, end));

    it('should give the places of the terms as the matcher finds them: whole words, an acronym in capitals', () => {
        expect(marked("L'UEFA VAR a revu le but, la VAR-Linie et Alvarez, le Var", ['VAR'])).toEqual(['VAR', 'VAR']);
        expect(marked('LA VALETTE-DU-VAR : Octobre Rose', ['VAR'])).toEqual([]);
        expect(marked('Infantino, infantino et INFANTINO', ['Infantino'])).toEqual(['Infantino', 'infantino', 'INFANTINO']);
    });

    it('should find a term with or without its accents, at its place in the text as written', () => {
        expect(marked('Zürich gagne à Zurich, Ramón Vega et Ramon  Vega', ['Zurich', 'Ramon Vega']))
            .toEqual(['Zürich', 'Zurich', 'Ramón Vega', 'Ramon  Vega']);
        // a letter longer in lowercase moves nothing
        expect(marked('İstanbul reçoit Infantino', ['Infantino'])).toEqual(['Infantino']);
    });

    it('should join the places of two terms that overlap, and give none without a term or a text', () => {
        expect(Filter.highlights('Gianni Infantino', ['Gianni Infantino', 'Infantino'])).toEqual([[0, 16]]);
        expect(Filter.highlights('Gianni Infantino', [])).toEqual([]);
        expect(Filter.highlights(null, ['VAR'])).toEqual([]);
    });
});
