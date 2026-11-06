//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: test.watched-news.js
//  Description: The news of the terms a profile follows: every news naming one, whatever its relevance,
//               one line per story, the newest ones listed as many as wanted and all of them counted
//

import {describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const {namesToMark, newsOfTerms} = await import('../../services/briefing-service.js');

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

// the page marks the names in the translation of a news too: the names it asks the places of (the user, 6.11.2026)
describe('namesToMark', () => {
    const follows = [
        {label: 'Nuri Şahin', qid: 'Q1', names: ['Nuri Şahin', 'Şahin', 'Nuri Sahin']},
        {label: 'VAR', qid: null, names: ['VAR']},
    ];

    it('should give the words of the news that were marked, then the names its group is followed by, each once whatever its case', () => {
        const news = {title: 'Nuri Şahin vor dem Aus', excerpt: 'Der Trainer nuri şahin steht unter Druck'};
        const marks = {title: [[0, 10]], excerpt: [[12, 22]]};
        expect(namesToMark(follows, {qid: 'Q1', term: 'Nuri Şahin'}, news, marks)).toEqual(['Nuri Şahin', 'Şahin', 'Nuri Sahin']);
    });

    it('should give the word followed as written for a word, and the term of a group that follows nothing', () => {
        expect(namesToMark(follows, {qid: null, term: 'VAR'}, {title: 'Die VAR greift ein'}, {title: [[4, 7]]})).toEqual(['VAR']);
        expect(namesToMark(follows, {qid: 'Q9', term: 'Unknown'}, {title: 'x'}, {})).toEqual(['Unknown']);
    });

    it('should keep the words of the news that no name of the group spells (a name the medium writes otherwise), at most 20 names of 60 characters', () => {
        const names = Array.from({length: 30}, (_, i) => `Name number ${i}`);
        const many = [{label: 'Many', qid: 'Q2', names: [...names, 'x'.repeat(61)]}];
        const got = namesToMark(many, {qid: 'Q2', term: 'Many'}, {title: 'Šahin signs'}, {title: [[0, 5]]});
        expect(got[0]).toBe('Šahin');
        expect(got).toHaveLength(20);
        expect(got.every(name => name.length <= 60)).toBe(true);
    });
});
