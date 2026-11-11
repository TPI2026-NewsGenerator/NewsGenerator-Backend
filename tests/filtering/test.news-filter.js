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

    it('should write the letters as they are when Postgres folds the accents of the text and of the pattern', () => {
        // the classes of accents ("[aàáâãäå]", 7 letters) are read by the index of trigrams as any letter: 30 to 60 s on a week (11.11.2026)
        expect(Filter.toPattern({text: 'Barça', exact: false}, {fold: true})).toBe('(^|[^[:alnum:]])Barça');
        expect(Filter.toPattern({text: 'Zürich vote', exact: true}, {fold: true})).toBe('(^|[^[:alnum:]])Zürich[[:space:]]+vote([^[:alnum:]]|$)');
        expect(Filter.toPattern({text: 'AI', exact: false}, {fold: true})).toBe('(?c)(^|[^[:alnum:]])AI([^[:alnum:]]|$)');
    });

    it('should fold the text and the pattern with the function it is given, in every condition', () => {
        const parsed = Filter.parse(['zurich, "red card" -Barça']);
        const folded = Filter.keywordsSql(parsed, 4, 'a.search_text', {fold: 'public.plain_text'});
        expect(folded.sql).toBe('((public.plain_text(a.search_text) ~* public.plain_text($4::text)) OR (public.plain_text(a.search_text) ~* public.plain_text($5::text))) AND NOT (public.plain_text(a.search_text) ~* public.plain_text($6::text))');
        expect(folded.params).toEqual(['(^|[^[:alnum:]])zurich', '(^|[^[:alnum:]])red[[:space:]]+card([^[:alnum:]]|$)', '(^|[^[:alnum:]])Barça']);
        // not given: as before
        expect(Filter.keywordsSql(parsed, 4, 'a.search_text').sql).toBe('((a.search_text ~* $4) OR (a.search_text ~* $5)) AND NOT (a.search_text ~* $6)');
    });

    it('should fold only the terms the index can serve: three letters at least, no acronym in capitals', () => {
        // an acronym is case-sensitive, a word of two letters has no trigram: both read every news of the window, folding each one would cost more
        const parsed = Filter.parse(['VAR, ai, zurich']);
        const sql = Filter.keywordsSql(parsed, 1, 'a.search_text', {fold: 'public.plain_text'});
        expect(sql.sql).toBe('((a.search_text ~* $1) OR (a.search_text ~* $2) OR (public.plain_text(a.search_text) ~* public.plain_text($3::text)))');
        expect(sql.params).toEqual([Filter.toPattern({text: 'VAR', exact: false}), Filter.toPattern({text: 'ai', exact: false}), '(^|[^[:alnum:]])zurich']);
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
// the client of the folded tests goes back to the pool first, else the pool waits for it
afterAll(async () => {
    folding?.release();
    await pool.end();
});

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

    it('should write the wider search back as keywords that search the same, its phrases and excluded words kept', () => {
        const wider = Filter.widen(Filter.parse(['"red card" referee -rugby -"yellow card"']));

        expect(Filter.toKeywords(wider)).toBe('"red card", referee, -rugby, -"yellow card"');
        expect(Filter.parse([Filter.toKeywords(wider)])).toEqual(wider);
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

// The same matching with the accents folded by Postgres (db/add_plain_search.sql): a function of this session stands for public.plain_text, so that
// nothing is written in the database. Everything the classes of accents found is found, and the letters they did not know
const FOLD = 'pg_temp.plain_text';
let unaccent = dbAvailable;
let folding;
if (dbAvailable) {
    try {
        folding = await pool.connect();
        await folding.query(`CREATE FUNCTION pg_temp.plain_text(text) RETURNS text LANGUAGE sql IMMUTABLE STRICT
            AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$`);
    } catch {
        unaccent = false;
        console.warn('unaccent not available, the folded Postgres filter tests are skipped');
    }
}

const foldedTitles = async (newsList, keywords) => {
    const parsed = Filter.parse(keywords);
    const values = [];
    const rows = newsList.map((news, i) => {
        values.push(i, news.title, news.description ?? '', news.category ?? []);
        const n = values.length - 3;
        return `($${n}::int, $${n + 1}::text, $${n + 2}::text, $${n + 3}::text[])`;
    });
    const keywordsSql = Filter.keywordsSql(parsed, values.length + 1, 's.search_text', {fold: FOLD});
    if (!keywordsSql) return [];
    const {rows: found} = await folding.query(`
        SELECT title FROM (
            SELECT t.position, t.title, public.article_search_text(t.title, t.description, t.category) AS search_text
            FROM (VALUES ${rows.join(', ')}) AS t(position, title, description, category)
        ) AS s
        WHERE ${keywordsSql.sql}
        ORDER BY position`, [...values, ...keywordsSql.params]);
    return found.map(row => row.title);
};

(unaccent ? describe : describe.skip)('Filter in Postgres, the accents folded', () => {
    it('should find and exclude a word with or without its accents, as the classes of accents did', async () => {
        const news = [{title: 'Le Barça répond'}, {title: 'Barca: the answer'}, {title: 'Zurich vote'}, {title: 'Zürich vote too'}];
        expect(await foldedTitles(news, ['barca'])).toEqual(['Le Barça répond', 'Barca: the answer']);
        expect(await foldedTitles(news, ['zürich'])).toEqual(['Zurich vote', 'Zürich vote too']);
        expect(await foldedTitles(news, ['zurich'])).toEqual(['Zurich vote', 'Zürich vote too']);
        expect(await foldedTitles(news, ['vote, answer -Barça'])).toEqual(['Zurich vote', 'Zürich vote too']);
        expect(await foldedTitles(news, ['"zurich vote"'])).toEqual(['Zurich vote', 'Zürich vote too']);
        expect(await foldedTitles(news, ['"zurich vote too"'])).toEqual(['Zürich vote too']);
    });

    it('should also find the letters the classes of Latin-1 did not know: Polish, Danish, German, Czech', async () => {
        const news = [{title: 'Łódź hosts the final'}, {title: 'Lodz hosts the final'}, {title: 'Ødegaard returns'}, {title: 'Odegaard returns'},
            {title: 'Straße gesperrt'}, {title: 'Strasse gesperrt'}, {title: 'Plzeň wins'}, {title: 'Plzen wins'}];
        expect(await foldedTitles(news, ['lodz'])).toEqual(['Łódź hosts the final', 'Lodz hosts the final']);
        expect(await foldedTitles(news, ['Ødegaard'])).toEqual(['Ødegaard returns', 'Odegaard returns']);
        expect(await foldedTitles(news, ['odegaard'])).toEqual(['Ødegaard returns', 'Odegaard returns']);
        expect(await foldedTitles(news, ['strasse'])).toEqual(['Straße gesperrt', 'Strasse gesperrt']);
        expect(await foldedTitles(news, ['plzen'])).toEqual(['Plzeň wins', 'Plzen wins']);
    });

    it('should keep what the search was: word starts, whole short words, acronyms in capitals, other scripts as written', async () => {
        expect(await foldedTitles([{title: 'La préchauffe du four'}], ['réchauffe'])).toEqual([]);
        expect(await foldedTitles([{title: 'Navarrete vs Valdez'}, {title: 'Howard Webb defends VAR decision'}], ['var'])).toEqual(['Howard Webb defends VAR decision']);
        const acronyms = [{title: 'OpenAI ships a new AI model'}, {title: "J'ai testé le Mac mini M4"}];
        expect(await foldedTitles(acronyms, ['AI'])).toEqual(['OpenAI ships a new AI model']);
        expect(await foldedTitles(acronyms, ['ai'])).toEqual(['OpenAI ships a new AI model', "J'ai testé le Mac mini M4"]);
        expect(await foldedTitles([{title: 'Ολυμπιακός νίκησε'}, {title: 'Παναθηναϊκός'}], ['Ολυμπιακός'])).toEqual(['Ολυμπιακός νίκησε']);
        expect(await foldedTitles([{title: 'C++ is 40 years old'}], ['c++'])).toHaveLength(1);
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
