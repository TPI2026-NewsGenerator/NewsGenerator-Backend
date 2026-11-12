//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: test.fifa-passages.js
//  Description: Tests for the passages of the news the map of the FIFA presidency reads (fifa-passages.js): a sentence that names the person and a
//               member, the confederations only with a word of stance, one passage for the same sentence in several stories, a bare
//               acronym only when the tagger linked it in the article. No network, no database
//

import {describe, expect, it} from '@jest/globals';
import {MEMBERS as members, MEMBER_LIST, memberOfFifa as one} from '../../services/utils/fifa-members.js';
import {aliasIndexOf, norm, passagesOf, sentencesOf, spanOf} from '../../services/utils/fifa-passages.js';

const index = aliasIndexOf({members: MEMBER_LIST});
const article = (id, text, more = {}) => ({id, title: text.split(' | ')[0], description: text.split(' | ')[1] ?? '', text, lang: 'en', medium: 'example.com', story: id, link: `https://example.com/${id}`, at: '2026-11-01T10:00:00Z', ...more});
const run = (news, linked = new Map()) => passagesOf({news, linked, index, members, terms: ['infantino']});

describe('text helpers', () => {
    it('should compare without accents, case and kinds of quotes, and find a name as a whole word', () => {
        expect(norm('Fédération Allemande — L’Équipe')).toBe('federation allemande — l\'equipe');
        expect(spanOf('the fa said', 'fa')).toBeGreaterThanOrEqual(0);
        expect(spanOf('the fan said', 'fa')).toBe(-1);
        expect(sentencesOf('One. Two! Three? | Four.')).toEqual(['One.', 'Two!', 'Three?', 'Four.']);
    });
});

describe('passagesOf', () => {
    it('should find the sentence that names the person and an association by its name', () => {
        const passages = run([article(1, 'Japan Football Association vice-president resigns over Infantino | Details are to come.')]);
        expect(passages).toHaveLength(1);
        expect(passages[0]).toMatchObject({member: {fifa: 'JPN'}, bound: 'loose', acronymOnly: false, article: {id: 1, date: '2026-11-01'}});
        expect(passages[0].sentence).toContain('Infantino');
    });

    it('should leave out a sentence with no person, and a person with no member', () => {
        expect(run([article(1, 'Japan Football Association announces a new coach | The coach starts in January.')])).toHaveLength(0);
        expect(run([article(2, 'Infantino opens a stadium | Nobody else is there.')])).toHaveLength(0);
    });

    it('should keep a confederation only with a word of support or opposition', () => {
        // a bare acronym counts only when the tagger linked it in the article
        const linked = new Map([[1, [{qid: one('UEFA').qid, name: 'UEFA'}]], [2, [{qid: one('UEFA').qid, name: 'UEFA'}]]]);
        expect(run([article(1, 'UEFA president Ceferin met Infantino in Zurich')], linked)).toHaveLength(0);
        const kept = run([article(2, 'UEFA president Ceferin criticised Infantino in Zurich')], linked);
        expect(kept).toHaveLength(1);
        expect(kept[0]).toMatchObject({member: {fifa: 'UEFA', level: 'confederation'}, stanceWords: {oppose: true}});
    });

    it('should take a bare acronym only when the tagger linked it in this article', () => {
        const text = 'JFA honorary president Tashima runs against Infantino';
        expect(run([article(1, text)])).toHaveLength(0);
        const linked = new Map([[1, [{qid: one('JPN').qid, name: 'JFA'}]]]);
        const passages = run([article(1, text)], linked);
        expect(passages).toHaveLength(1);
        expect(passages[0]).toMatchObject({member: {fifa: 'JPN'}, bound: 'strict', acronymOnly: true});
    });

    it('should make one passage of the same sentence in several stories, counting the news and the media', () => {
        const text = 'The Danish Football Association says it will not back Infantino';
        const passages = run([article(1, text, {medium: 'a.com', story: 10}), article(2, text, {medium: 'b.com', story: 11}), article(3, text, {medium: 'b.com', story: 12})]);
        expect(passages).toHaveLength(1);
        expect(passages[0]).toMatchObject({news: 3, media: 2});
        expect(passages[0].hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should give the same hash to the same sentence of the same association, whatever the article', () => {
        const text = 'The Danish Football Association says it will not back Infantino';
        const a = run([article(1, text)])[0].hash;
        const b = run([article(9, text, {at: '2026-11-05T10:00:00Z'})])[0].hash;
        expect(a).toBe(b);
    });
});
