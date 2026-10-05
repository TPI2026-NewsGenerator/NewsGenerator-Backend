//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: test.stories.js
//  Description: Tests of the two computations made by pgvector: the grouping of the news into
//               stories (assign_stories) and the stories closest to a profile (rank_stories)
//

import process from 'node:process'
import 'dotenv/config';
import pg from 'pg';
import {toSparsevec, toVector} from '../../services/utils/embedder.js'

// Both functions live in the database (db/add_briefing.sql), so they are tested there. Every test
// runs in a transaction rolled back at its end, on news dated 2100 so they never meet real ones.
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
let dbAvailable = true;
try {
    await pool.query("SELECT 'public.assign_stories'::regproc, 'public.rank_stories'::regproc, '[1]'::vector");
} catch {
    dbAvailable = false;
    console.warn('Database, pgvector or db/add_briefing.sql not available, the story tests are skipped');
}
afterAll(() => pool.end());

const SINCE = '2099-12-31T00:00:00Z';
const THRESHOLD = 0.70;
const SAME_MEDIUM_MARGIN = 0.5;
const TEXT_THRESHOLD = 0.6;
const IDLE_DECAY = 0.003;
const IDLE_GRACE = 6;

// a normalized vector of 1024 numbers, the ones given first and zeros after
const dense = (...values) => {
    const vector = new Float32Array(1024);
    const norm = Math.hypot(...values);
    values.forEach((value, i) => vector[i] = value / norm);
    return toVector(vector);
};
const NO_WORDS = toSparsevec({});

// the test in a transaction, with one feed; rolled back whatever happens
const inTransaction = async (test) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const {rows: [feed]} = await client.query("INSERT INTO feeds (url) VALUES ('https://test.invalid/feed') RETURNING id");
        await test(client, feed.id);
    } finally {
        await client.query('ROLLBACK');
        client.release();
    }
};

// a word of its own for each title, without figures (they would keep two titles of one medium apart)
const word = () => Array.from({length: 12}, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

// a news embedded, published 'minute' minutes after 2100 began; in a story when 'story' is given.
// Each news comes from a medium of its own unless 'medium' names one ("a" -> https://a.invalid/...).
const news = async (client, feed, {minute = 0, lang = 'en', title, text, titleWords = NO_WORDS, textWords = NO_WORDS,
                                   story = null, medium = null, link = null, heading = null}) => {
    const {rows: [row]} = await client.query(`
        INSERT INTO articles (id_feed, link, title, published_at, lang, title_dense, title_sparse, text_dense, text_sparse, embedded_at, id_story)
        VALUES ($1, $2, $3, timestamptz '2100-01-01T00:00:00Z' + make_interval(mins => $4), $5,
                $6::halfvec, $7::sparsevec, $8::halfvec, $9::sparsevec, now(), $10)
        RETURNING id`,
        [feed, link ?? `https://${medium ?? word()}.invalid/${word()}`, heading ?? `test ${word()}`, minute, lang, title ?? text, titleWords, text ?? title, textWords, story]);
    return row.id;
};

const storyOf = async (client, id) => (await client.query('SELECT id_story FROM articles WHERE id = $1', [id])).rows[0].id_story;
const assign = async (client, sparseWeight = 1) => (await client.query('SELECT * FROM public.assign_stories($1, $2, $3, $4, $5, $6, $7)',
    [SINCE, THRESHOLD, sparseWeight, SAME_MEDIUM_MARGIN, TEXT_THRESHOLD, IDLE_DECAY, IDLE_GRACE])).rows[0];

(dbAvailable ? describe : describe.skip)('assign_stories', () => {
    it('should put the news telling the same thing in one story, and the others apart', () => inTransaction(async (client, feed) => {
        const a = await news(client, feed, {minute: 1, title: dense(1, 0)});
        const b = await news(client, feed, {minute: 2, title: dense(1, 0.1)});
        const c = await news(client, feed, {minute: 3, title: dense(0, 1)});

        expect(await assign(client)).toEqual({grouped: 3, created: 2});
        expect(await storyOf(client, a)).toBe(await storyOf(client, b));
        expect(await storyOf(client, c)).not.toBe(await storyOf(client, a));
    }));

    it('should group only the newest news asked for, and leave the others to the next call', () => inTransaction(async (client, feed) => {
        const oldest = await news(client, feed, {minute: 1, title: dense(1, 0)});
        const newer = await news(client, feed, {minute: 2, title: dense(0, 1)});
        const newest = await news(client, feed, {minute: 3, title: dense(1, 1, 1)});

        const {rows: [first]} = await client.query('SELECT * FROM public.assign_stories($1, $2, $3, $4, $5, $6, $7, $8)',
            [SINCE, THRESHOLD, 1, SAME_MEDIUM_MARGIN, TEXT_THRESHOLD, IDLE_DECAY, IDLE_GRACE, 2]);
        expect(first.grouped).toBe(2);
        expect(await storyOf(client, newest)).not.toBeNull();
        expect(await storyOf(client, newer)).not.toBeNull();
        expect(await storyOf(client, oldest)).toBeNull();

        expect((await assign(client)).grouped).toBe(1);
        expect(await storyOf(client, oldest)).not.toBeNull();
    }));

    it('should join a story on the average of its members, not on one of them', () => inTransaction(async (client, feed) => {
        const {rows: [{id: story}]} = await client.query("INSERT INTO stories (lang) VALUES ('en') RETURNING id");
        await news(client, feed, {title: dense(1, 0, 0), story});
        await news(client, feed, {title: dense(0, 1, 0), story});
        await news(client, feed, {title: dense(0, 0, 1), story});

        const close = await news(client, feed, {minute: 5, title: dense(1, 0, 0)});        // 1, 0, 0: 0.33 on average
        await assign(client);
        expect(await storyOf(client, close)).not.toBe(story);
    }));

    it('should never group two languages', () => inTransaction(async (client, feed) => {
        const en = await news(client, feed, {minute: 1, lang: 'en', title: dense(1, 0)});
        const fr = await news(client, feed, {minute: 2, lang: 'fr', title: dense(1, 0)});
        await assign(client);
        expect(await storyOf(client, en)).not.toBe(await storyOf(client, fr));
    }));

    it('should add the words two titles share to their meaning', () => inTransaction(async (client, feed) => {
        // dense 0.6: apart on its meaning alone, together with the name they share (0.5 * 0.4)
        const a = await news(client, feed, {minute: 1, title: dense(1, 0), text: dense(1, 0), titleWords: toSparsevec({42: 0.5})});
        const b = await news(client, feed, {minute: 2, title: dense(0.6, 0.8), text: dense(1, 0), titleWords: toSparsevec({42: 0.4})});
        await assign(client, 1);
        expect(await storyOf(client, a)).toBe(await storyOf(client, b));
    }));

    it('should leave them apart when the words do not count', () => inTransaction(async (client, feed) => {
        const a = await news(client, feed, {minute: 1, title: dense(1, 0), text: dense(1, 0), titleWords: toSparsevec({42: 0.5})});
        const b = await news(client, feed, {minute: 2, title: dense(0.6, 0.8), text: dense(1, 0), titleWords: toSparsevec({42: 0.4})});
        await assign(client, 0);
        expect(await storyOf(client, a)).not.toBe(await storyOf(client, b));
    }));

    it('should keep apart two media whose titles meet but whose texts tell other facts', () => inTransaction(async (client, feed) => {
        // one subject ("the balance of power"), two facts: the titles are close, the texts are not
        const a = await news(client, feed, {minute: 1, title: dense(1, 0), text: dense(1, 0, 0)});
        const b = await news(client, feed, {minute: 2, title: dense(1, 0.1), text: dense(0.5, 0, 0.87)});
        await assign(client);
        expect(await storyOf(client, a)).not.toBe(await storyOf(client, b));
    }));

    it('should keep apart two titles of one medium that only look alike', () => inTransaction(async (client, feed) => {
        // 0.99: together from two media, but the template of one medium ("Is X v Y on TV?") needs more
        const a = await news(client, feed, {minute: 1, medium: 'paper', title: dense(1, 0)});
        const b = await news(client, feed, {minute: 2, medium: 'paper', title: dense(1, 0.15)});
        await assign(client);
        expect(await storyOf(client, a)).not.toBe(await storyOf(client, b));
    }));

    it('should group two titles of one medium telling the same with almost the same words', () => inTransaction(async (client, feed) => {
        const a = await news(client, feed, {minute: 1, medium: 'paper', title: dense(1, 0), titleWords: toSparsevec({42: 0.5})});
        const b = await news(client, feed, {minute: 2, medium: 'paper', title: dense(1, 0.1), titleWords: toSparsevec({42: 0.5})});
        await assign(client);
        expect(await storyOf(client, a)).toBe(await storyOf(client, b));
    }));

    it('should keep apart two titles of one medium giving other figures', () => inTransaction(async (client, feed) => {
        const words = toSparsevec({42: 0.5});
        const a = await news(client, feed, {minute: 1, medium: 'paper', title: dense(1, 0), titleWords: words, heading: 'Oil market news for Sept. 23'});
        const b = await news(client, feed, {minute: 2, medium: 'paper', title: dense(1, 0), titleWords: words, heading: 'Oil market news for Sept. 22'});
        await assign(client);
        expect(await storyOf(client, a)).not.toBe(await storyOf(client, b));
    }));

    it('should judge a story on the other media only', () => inTransaction(async (client, feed) => {
        // the template of the paper is close to the paper's own news, far from what the others wrote
        const {rows: [{id: story}]} = await client.query("INSERT INTO stories (lang) VALUES ('en') RETURNING id");
        await news(client, feed, {medium: 'paper', title: dense(1, 0, 0), story});
        await news(client, feed, {medium: 'other', title: dense(0.6, 0.8, 0), story});
        const template = await news(client, feed, {minute: 5, medium: 'paper', title: dense(1, 0, 0.2)});
        const same = await news(client, feed, {minute: 6, medium: 'third', title: dense(0.6, 0.8, 0)});
        await assign(client);
        expect(await storyOf(client, template)).not.toBe(story);
        expect(await storyOf(client, same)).toBe(story);
    }));

    it('should put the same news met in another feed of its medium in its story', () => inTransaction(async (client, feed) => {
        const {rows: [{id: other}]} = await client.query("INSERT INTO feeds (url) VALUES ('https://test.invalid/other') RETURNING id");
        const a = await news(client, feed, {minute: 1, link: 'https://paper.invalid/news', title: dense(1, 0)});
        const b = await news(client, other, {minute: 2, link: 'https://paper.invalid/news', title: dense(1, 0)});
        await assign(client);
        expect(await storyOf(client, a)).toBe(await storyOf(client, b));
    }));

    // some feeds give no title (uol.com.br puts it in the description): an empty title is not the same
    // news met again, it put every news of such a medium in one story (459 in 48 h, 5.10.2026). The
    // embedder gives them all the same title vector and no words: too little for one medium alone
    it('should not take an empty title for the same news, but still a same link', () => inTransaction(async (client, feed) => {
        const {rows: [{id: other}]} = await client.query("INSERT INTO feeds (url) VALUES ('https://test.invalid/other') RETURNING id");
        const a = await news(client, feed, {minute: 1, medium: 'paper', heading: '', title: dense(1, 0), text: dense(1, 0, 0)});
        const b = await news(client, feed, {minute: 2, medium: 'paper', heading: '', title: dense(1, 0), text: dense(0, 1, 0)});
        const c = await news(client, feed, {minute: 3, medium: 'paper', heading: ' \t', title: dense(1, 0), text: dense(0, 0, 1)});
        const again = await news(client, other, {minute: 4, link: (await client.query('SELECT link FROM articles WHERE id = $1', [a])).rows[0].link,
                                                 heading: '', title: dense(1, 0), text: dense(1, 0, 0)});
        await assign(client);
        expect(new Set([await storyOf(client, a), await storyOf(client, b), await storyOf(client, c)]).size).toBe(3);
        expect(await storyOf(client, again)).toBe(await storyOf(client, a));
    }));

    // 0.75 on the titles: enough a few hours later, not a day and a half later (0.003 * (36 - 6) = 0.09
    // less), unless the news is almost the same. Grouped run by run, as the news come
    it('should take a news close enough a few hours later', () => inTransaction(async (client, feed) => {
        const a = await news(client, feed, {minute: 0, title: dense(1, 0)});
        await assign(client);
        const soon = await news(client, feed, {minute: 3 * 60, title: dense(0.75, 0.66)});
        await assign(client);
        expect(await storyOf(client, soon)).toBe(await storyOf(client, a));
    }));

    it('should ask more of a news the longer its story has been quiet', () => inTransaction(async (client, feed) => {
        const a = await news(client, feed, {minute: 0, title: dense(1, 0)});
        await assign(client);
        const late = await news(client, feed, {minute: 36 * 60, title: dense(0.75, 0.66)});
        await assign(client);
        const again = await news(client, feed, {minute: 37 * 60, title: dense(1, 0.05)});
        await assign(client);
        expect(await storyOf(client, late)).not.toBe(await storyOf(client, a));
        expect(await storyOf(client, again)).toBe(await storyOf(client, a));
    }));

    // previews of every match written the same way: their vectors meet, their teams do not
    it('should keep a match out of a story of another match', () => inTransaction(async (client, feed) => {
        const {rows: [{id: story}]} = await client.query("INSERT INTO stories (lang) VALUES ('en') RETURNING id");
        await news(client, feed, {title: dense(1, 0), story, heading: 'Spain vs Croatia Prediction and Betting Tips'});
        await news(client, feed, {title: dense(1, 0), story, heading: 'PREVIEW | Spain vs Croatia: team news, lineups'});
        const other = await news(client, feed, {minute: 5, title: dense(1, 0), heading: 'Czechia vs England Prediction and Betting Tips'});
        const same = await news(client, feed, {minute: 6, title: dense(1, 0), heading: 'How to watch Spain vs Croatia: TV channel'});
        await assign(client);
        expect(await storyOf(client, other)).not.toBe(story);
        expect(await storyOf(client, same)).toBe(story);
    }));

    it('should date a story from its newest news', () => inTransaction(async (client, feed) => {
        const a = await news(client, feed, {minute: 1, title: dense(1, 0)});
        await news(client, feed, {minute: 30, title: dense(1, 0)});
        await assign(client);
        const {rows: [story]} = await client.query('SELECT updated_at FROM stories WHERE id = $1', [await storyOf(client, a)]);
        expect(story.updated_at.toISOString()).toBe('2100-01-01T00:30:00.000Z');
    }));
});

(dbAvailable ? describe : describe.skip)('matchup_of and different_matches', () => {
    const matchup = async (title) => (await pool.query('SELECT public.matchup_of($1) AS teams', [title])).rows[0].teams;
    const different = async (a, b) => (await pool.query(
        'SELECT public.different_matches(public.matchup_of($1), public.title_names($1), $2) AS different', [a, b])).rows[0].different;

    it('should read the match a title opens with', async () => {
        expect(await matchup('Spain vs Croatia Prediction and Betting Tips | September 29th 2026')).toEqual(['spa', 'cro']);
        expect(await matchup('Prediction: Croatia vs England')).toEqual(['cro', 'eng']);
        expect(await matchup('How to watch Belgium vs. Türkiye: Free streams')).toEqual(['bel', 'tur']);
        expect(await matchup('Belgium vs. Türkiye Lineups')).toEqual(['bel', 'tur']);
    });

    it('should read no match in a sentence, a word without a capital or an opponent not known yet', async () => {
        expect(await matchup('Browns Fans Turnaround in Win vs. Steelers')).toBeNull();
        expect(await matchup('Jerry Jones update on his status vs. Texans')).toBeNull();
        expect(await matchup('TBD vs Karen Khachanov · Quarterfinal')).toBeNull();
        expect(await matchup('Galeria-Krise: die Lage spitzt sich zu')).toBeNull();
    });

    it('should tell two matches apart, and one match written two ways', async () => {
        expect(await different('Egypt vs Angola - Betting Tips', 'Togo vs Burundi - Betting Tips')).toBe(true);
        expect(await different('Wales vs Denmark - prediction', 'Wales v Norway kick-off time')).toBe(true);
        expect(await different('Czech Republic v England LIVE', 'England Player Ratings vs. Czechia')).toBe(false);
        expect(await different('Bucs vs. Packers: What To Watch For', 'Buccaneers vs. Packers: injury report')).toBe(false);
        // "Game" is no team: each title holds a team of the other
        expect(await different('Giants Ready for Game vs. Cards', 'New York Giants vs. Arizona Cardinals')).toBe(false);
        // the words without a capital are no names: "canal" is not Canada
        expect(await different('Dónde ver Brasil vs India: canal tv', 'Dónde ver Perú vs Canadá: canal tv')).toBe(true);
        expect(await different('Spain vs Croatia preview', 'Real Madrid sign a striker')).toBeNull();
    });
});

(dbAvailable ? describe : describe.skip)('rank_stories', () => {
    // a user of the test, two interests (rugby on the first axis, fashion on the second), and three
    // stories: rugby, fashion a little, and nothing asked
    const setUp = async (client, feed) => {
        const {rows: [user]} = await client.query(`
            INSERT INTO users (username, email, password, role)
            VALUES ('test-rank', 'test-rank@test.invalid', 'not-a-password', (SELECT MIN(id) FROM roles))
            RETURNING id`);
        const interest = async (position, vector, weight = 1) => (await client.query(`
            INSERT INTO profile_interests (id_user, position, text, weight, dense, sparse)
            VALUES ($1, $2, 'test', $3, $4::vector, $5::sparsevec) RETURNING id`,
            [user.id, position, weight, vector, NO_WORDS])).rows[0].id;
        const rugby = await interest(0, dense(1, 0, 0));
        const fashion = await interest(1, dense(0, 1, 0));

        const story = async () => (await client.query("INSERT INTO stories (lang) VALUES ('en') RETURNING id")).rows[0].id;
        const [s1, s2, s3] = [await story(), await story(), await story()];
        const best = await news(client, feed, {text: dense(1, 0, 0), story: s1});
        await news(client, feed, {text: dense(1, 0, 1), story: s1});
        const a2 = await news(client, feed, {text: dense(0.2, 1, 0.5), story: s2});
        await news(client, feed, {text: dense(0, 0, 1), story: s3});

        return {user: user.id, rugby, fashion, s1, s2, s3, best, a2};
    };

    const rank = async (client, user, {feeds = ['https://test.invalid/feed'], languages = ['en'], excluded = []} = {}) => (await client.query(
        'SELECT * FROM public.rank_stories($1, $2, $3, $4, 0.5, $5, 10)', [user, feeds, languages, SINCE, excluded])).rows;

    it('should rank the stories by their news closest to any interest', () => inTransaction(async (client, feed) => {
        const t = await setUp(client, feed);
        const ranked = await rank(client, t.user);

        expect(ranked.map(row => row.id_story)).toEqual([t.s1, t.s2, t.s3]);
        expect(ranked[0]).toMatchObject({id_article: t.best, id_interest: t.rugby});
        expect(ranked[0].score).toBeCloseTo(1);
        expect(ranked[1]).toMatchObject({id_article: t.a2, id_interest: t.fashion});
    }));

    it('should leave out the stories already shown and the feeds the user does not read', () => inTransaction(async (client, feed) => {
        const t = await setUp(client, feed);
        expect((await rank(client, t.user, {excluded: [t.s1]})).map(row => row.id_story)).toEqual([t.s2, t.s3]);
        expect(await rank(client, t.user, {feeds: ['https://test.invalid/another']})).toEqual([]);
    }));

    it('should leave out the news in the languages not asked, and read every language without one', () => inTransaction(async (client, feed) => {
        const t = await setUp(client, feed);
        expect(await rank(client, t.user, {languages: ['fr', 'es']})).toEqual([]);
        expect((await rank(client, t.user, {languages: null})).map(row => row.id_story)).toEqual([t.s1, t.s2, t.s3]);
    }));

    it('should give a secondary interest less weight', () => inTransaction(async (client, feed) => {
        const t = await setUp(client, feed);
        await client.query('UPDATE profile_interests SET weight = 0.5 WHERE id = $1', [t.rugby]);
        const ranked = await rank(client, t.user);
        expect(ranked[0].id_story).toBe(t.s2);
    }));
});
