//
//  Author: Fabian Rostello
//  Date: 06.10.2026
//  File: test.read-stories.js
//  Description: The chosen stories of a briefing read: a story no article of which could be read in
//               full (a paywall, a protected site) is said unreadable, so it never becomes a card
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
jest.unstable_mockModule('../../services/utils/crawlers.js', () => ({Crawlers: {Html: jest.fn()}}));
jest.unstable_mockModule('../../models/feed-model.js', () => ({FeedModel: {saveResolvedLinks: jest.fn(async () => {})}}));
jest.unstable_mockModule('../../services/utils/contested.js', () => ({contestedOf: jest.fn(async () => [])}));
const extract = await import('../../services/utils/extract.js');
jest.unstable_mockModule('../../services/utils/extract.js', () => ({...extract, extractArticle: jest.fn()}));

const {readStories} = await import('../../services/briefing-service.js');
const {Crawlers} = await import('../../services/utils/crawlers.js');
const {extractArticle} = await import('../../services/utils/extract.js');

const words = (count) => Array.from({length: count}, (_, i) => `word${i}`).join(' ') + '.';
const FULL = `${words(80)} ${words(80)}`;
// what a paywall leaves: the first lines and a call to subscribe
const TEASER = 'Infantino ohne Ende? Wie reformiert man die FIFA, Herr Duval? Jetzt weiterlesen mit F+.';

const article = (link, title = 'A news') => ({link, title, feed_url: 'https://example.org/rss', lang: 'en', at: new Date('2026-10-06T06:00:00Z')});
const story = (storyId, ...members) => ({storyId, best: members[0], members});
const usage = {summarizing: {}, contesting: {}};

beforeEach(() => {
    Crawlers.Html.mockReset();
    extractArticle.mockReset();
    // a passage is a paragraph of sentences (see extract.js)
    extractArticle.mockResolvedValue({passages: [[{text: 'The first sentence.'}]], translation: [], topic: null, sourcing: null});
});

describe('readStories', () => {
    it('should say unreadable a story whose only article stops at a paywall', async () => {
        Crawlers.Html.mockResolvedValue([{url: 'https://www.faz.net/fifa', content: TEASER}]);
        const [read] = await readStories([story(1, article('https://www.faz.net/fifa'))], {usage});
        expect(read.unreadable).toBe(true);
        expect(read.summary).toBeNull();
        expect(extractArticle).not.toHaveBeenCalled();
    });

    it('should say unreadable a story whose page could not be fetched at all', async () => {
        Crawlers.Html.mockResolvedValue([]);
        const [read] = await readStories([story(1, article('https://www.protected.example/news'))], {usage});
        expect(read.unreadable).toBe(true);
    });

    it('should read a story through another of its media when the first one has a paywall', async () => {
        Crawlers.Html.mockResolvedValue([
            {url: 'https://www.faz.net/fifa', content: TEASER},
            {url: 'https://www.kicker.de/fifa', content: FULL},
        ]);
        const [read] = await readStories([story(1, article('https://www.faz.net/fifa'), article('https://www.kicker.de/fifa'))], {usage});
        expect(read.unreadable).toBe(false);
        expect(read.summary.from).toBe('https://www.kicker.de/fifa');
    });

    it('should say unreadable a page read in which the AI found no passage of the news', async () => {
        Crawlers.Html.mockResolvedValue([{url: 'https://www.example.org/a', content: FULL}]);
        extractArticle.mockResolvedValue({passages: [], translation: [], topic: null, sourcing: null});
        const [read] = await readStories([story(1, article('https://www.example.org/a'))], {usage});
        expect(read.unreadable).toBe(true);
    });

    it('should keep a story read when the AI fails on it, without calling it unreadable', async () => {
        Crawlers.Html.mockResolvedValue([{url: 'https://www.example.org/a', content: FULL}]);
        extractArticle.mockRejectedValue(new Error('AI down'));
        const [read] = await readStories([story(1, article('https://www.example.org/a'))], {usage});
        expect(read.unreadable).toBe(false);
        expect(read.summary).toBeNull();
    });

    it('should keep the pages read for counting who wrote the cards', async () => {
        Crawlers.Html.mockResolvedValue([{url: 'https://www.example.org/a', content: FULL}]);
        const content = new Map();
        await readStories([story(1, article('https://www.example.org/a'))], {usage, content});
        expect(content.get('https://www.example.org/a').content).toBe(FULL);
    });
});
