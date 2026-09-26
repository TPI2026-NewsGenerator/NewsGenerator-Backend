//
//  Author: Fabian Rostello
//  Date: 26.09.2026
//  File: test.google-news.js
//  Description: Tests for the searches of Google News read like feeds, the real address of their
//               articles and the stories they alone tell
//

import {describe, expect, it} from '@jest/globals';
import {
    articleIdOf, credibleStory, interestSearchUrls, isNotNews, isPlatform, pickCandidates, isGoogleNewsUrl, languageOfSearch, parseBatchAnswer,
    searchUrl, withoutPublisher,
} from '../../services/utils/google-news.js';

const GOOGLE = 'https://news.google.com/rss/search?q=x&hl=fr&gl=FR&ceid=FR:fr';

describe('interestSearchUrls', () => {
    it('should give one feed per search of the interests, in the languages of the reader only', () => {
        const urls = interestSearchUrls(['fr:arbitrage football', 'en:football VAR', 'es:árbitro', 'fr:arbitrage football'], ['fr', 'en']);
        expect(urls).toEqual([
            'https://news.google.com/rss/search?q=arbitrage%20football%20when%3A2d&hl=fr&gl=FR&ceid=FR:fr',
            'https://news.google.com/rss/search?q=football%20VAR%20when%3A2d&hl=en-US&gl=US&ceid=US:en',
        ]);
        expect(urls.map(languageOfSearch)).toEqual(['fr', 'en']);
    });

    it('should ignore a search without its language', () => {
        expect(interestSearchUrls(['arbitrage football', 'fr:  '], ['fr'])).toEqual([]);
    });

    it('should tell the feeds of Google News from the others', () => {
        expect(isGoogleNewsUrl(searchUrl(['uefa']))).toBe(true);
        expect(isGoogleNewsUrl('https://rss.tribuna.com/en/feed.xml')).toBe(false);
        expect(languageOfSearch('https://rss.tribuna.com/en/feed.xml')).toBeNull();
    });
});

describe('withoutPublisher', () => {
    it('should take the publisher Google writes after the title away', () => {
        expect(withoutPublisher('Week 3 referee assignments - Football Zebras', 'Football Zebras')).toBe('Week 3 referee assignments');
        expect(withoutPublisher('A - B', null)).toBe('A - B');
    });
});

describe('the real address of an article', () => {
    it('should find the id of an article in a link of Google News', () => {
        expect(articleIdOf('https://news.google.com/rss/articles/CBMiabc123?oc=5')).toBe('CBMiabc123');
        expect(articleIdOf('https://news.google.com/articles/CBMixyz')).toBe('CBMixyz');
        expect(articleIdOf('https://www.lequipe.fr/articles/123')).toBeNull();
        expect(articleIdOf('not a link')).toBeNull();
    });

    it('should give each address to its call, whatever the order Google answers in', () => {
        const entry = (call, url) => ['wrb.fr', 'Fbv4je', JSON.stringify(['garturlres', url, 1]), null, null, null, String(call)];
        const answer = `)]}'\n\n${JSON.stringify([
            entry(2, 'https://www.wctv.tv/scoreboard/'),
            entry(1, 'https://clemsontigers.com/gallery'),
            ['di', 42],
            entry(3, 'javascript:alert(1)'),
        ])}\n\n25\n[["e",4]]`;
        expect(parseBatchAnswer(answer, 4)).toEqual(['https://clemsontigers.com/gallery', 'https://www.wctv.tv/scoreboard/', null, null]);
    });

    it('should answer nothing found for an answer it does not understand', () => {
        expect(parseBatchAnswer('<html>error</html>', 2)).toEqual([null, null]);
    });
});

describe('credibleStory', () => {
    const established = new Set(['lequipe.fr', 'goal.com']);
    const google = (medium) => ({feed_url: GOOGLE, medium});

    it('should keep a story a feed of the server tells, whatever Google says', () => {
        expect(credibleStory([{feed_url: 'https://rss.tribuna.com/en/feed.xml', medium: 'tribuna.com'}, google('spam.com')], established)).toBe(true);
    });

    it('should leave out a story only one unknown medium tells through Google News', () => {
        expect(credibleStory([google('horticulture-abadie-pyrenees.com'), google('horticulture-abadie-pyrenees.com')], established)).toBe(false);
    });

    it('should never count a social network or a video platform as a voice', () => {
        expect(credibleStory([google('facebook.com')], new Set(['facebook.com']))).toBe(false);
        expect(credibleStory([google('facebook.com'), google('youtube.com')], established)).toBe(false);
        expect(isPlatform('https://www.facebook.com')).toBe(true);
        expect(isPlatform('https://m.youtube.com')).toBe(true);
        expect(isPlatform('https://www.lequipe.fr')).toBe(false);
    });

    it('should keep a story two media tell through Google News, or one medium the server reads', () => {
        expect(credibleStory([google('myjoyonline.com'), google('pulse.com.gh')], established)).toBe(true);
        expect(credibleStory([google('lequipe.fr')], established)).toBe(true);
    });
});

describe('isNotNews', () => {
    it('should leave out the tables, live pages, streams and tickets Google News answers', () => {
        expect(isNotNews('Fasofoot Ligue 1 Table: Football Scores, Results & Fixtures')).toBe(true);
        expect(isNotNews('Ligue 1 Table - 2026/2027')).toBe(true);
        expect(isNotNews('Turquie - France en direct - Ligue des Nations : Football Scores & Résultats - 25/09/2026')).toBe(true);
        expect(isNotNews('Where to watch Turkiye vs. France live stream, TV channel, start time')).toBe(true);
        expect(isNotNews('Comment obtenir des billets pour Lille - Le Havre : prix en Ligue 1')).toBe(true);
        expect(isNotNews('À quelle heure et sur quelle chaîne regarder Angleterre-Espagne en Ligue des nations ?')).toBe(true);
    });

    it('should know a live blog or a table by its address once decoded', () => {
        expect(isNotNews('European football news and transfers', 'https://www.skysports.com/football/live-blog/13575723/european')).toBe(true);
        expect(isNotNews('x', 'https://www.tntsports.co.uk/football/fasofoot-ligue-1/2026-2027/asfb/live-table.shtml')).toBe(true);
        expect(isNotNews('x', GOOGLE)).toBe(false);
    });

    it('should keep the news that only name a table, results or tickets', () => {
        expect(isNotNews('Arsenal go top of the table after win')).toBe(false);
        expect(isNotNews('Election results: what they mean for Europe', 'https://www.bbc.com/news/election-results-2026')).toBe(false);
        expect(isNotNews('Tickets for the final sold out in minutes')).toBe(false);
        expect(isNotNews('Turquie - France : les notes des Bleus', 'https://www.lequipe.fr/Football/Actualites/notes/123')).toBe(false);
    });
});

describe('pickCandidates', () => {
    const feed = 'https://rss.tribuna.com/en/feed.xml';
    const story = (id, medium, feeds) => ({id, best: {medium}, members: feeds.map(url => ({feed_url: url, medium}))});

    it('should keep the stories of the feeds as before, and add a few known only through Google', () => {
        const stories = [
            story('g1', 'canalplus.com', [GOOGLE]),
            story('g2', 'canalplus.com', [GOOGLE]),
            story('g3', 'canalplus.com', [GOOGLE]),
            story('f1', 'tribuna.com', [feed, GOOGLE]),
            story('g4', 'myjoyonline.com', [GOOGLE]),
            story('f2', 'tribuna.com', [feed]),
            story('f3', 'tribuna.com', [feed]),
        ];
        const picked = pickCandidates(stories, {fromFeeds: 2, extra: 2, perMedium: 2});
        expect(picked.map(s => s.id)).toEqual(['g1', 'g2', 'f1', 'f2']);
        expect(pickCandidates(stories, {fromFeeds: 2, extra: 3, perMedium: 1}).map(s => s.id)).toEqual(['g1', 'f1', 'g4', 'f2']);
    });
});
