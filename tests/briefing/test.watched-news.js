//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: test.watched-news.js
//  Description: The news of the terms a profile follows: every news naming one, whatever its relevance,
//               one line per story, the newest ones listed as many as wanted and all of them counted
//

import {describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const {newsOfTerms} = await import('../../services/briefing-service.js');

const at = new Date('2026-10-08T12:00:00Z');
const article = (id, story, title, changes = {}) => ({
    id, id_story: story, title, description: '', link: `https://media${id % 7}.example/${id}`, lang: 'en',
    published_at: new Date(at - id * 60e3), ...changes,
});

describe('newsOfTerms', () => {
    it('should list one line per story, the 100 newest, and count them all', () => {
        // the newest first, as the search answers them
        const articles = Array.from({length: 130}, (_, i) => article(i + 1, i + 1, `Dario Amodei speaks, part ${i + 1}`));

        const [group] = newsOfTerms(['Dario Amodei'], articles);

        expect(group.count).toBe(130);
        expect(group.news).toHaveLength(100);
        expect(group.news[0].title).toBe('Dario Amodei speaks, part 1');
    });

    it('should list the news wanted, fewer than the 100 by default, and still count them all', () => {
        const articles = Array.from({length: 130}, (_, i) => article(i + 1, i + 1, `Dario Amodei speaks, part ${i + 1}`));

        const [group] = newsOfTerms(['Dario Amodei'], articles, {limit: 20});

        expect(group.count).toBe(130);
        expect(group.news).toHaveLength(20);
    });

    it('should join the news of one story, telling how many media told it, and keep a news named in its description', () => {
        const [group] = newsOfTerms(['Dario Amodei'], [
            article(1, 10, 'Anthropic chief speaks', {description: 'The words of Dario Amodei on safety.'}),
            article(2, 10, 'Dario Amodei speaks', {link: 'https://other.example/2'}),
            article(3, 11, 'Nothing about him', {description: 'Amodeis is another word.'}),
        ]);

        expect(group.count).toBe(1);
        expect(group.news).toEqual([expect.objectContaining({storyId: 10, title: 'Anthropic chief speaks', media: 2, excerpt: 'The words of Dario Amodei on safety.'})]);
    });

    it('should give the link of the feed beside the address shown, for the translation of the title', () => {
        const [group] = newsOfTerms(['Dario Amodei'], [article(1, 10, 'Dario Amodei speaks',
            {link: 'https://news.google.com/rss/articles/abc', resolved_link: 'https://medium.example/amodei'})]);

        expect(group.news[0]).toMatchObject({url: 'https://medium.example/amodei', link: 'https://news.google.com/rss/articles/abc', language: 'en'});
    });

    it('should count none for a term no news names, and read an acronym as written', () => {
        const groups = newsOfTerms(['Dario Amodei', 'VAR'], [article(1, 10, 'Le Var sous la pluie'), article(2, 11, 'La VAR a tranché')]);

        expect(groups.map(group => [group.term, group.count])).toEqual([['Dario Amodei', 0], ['VAR', 1]]);
        expect(groups[0].news).toEqual([]);
    });
});
