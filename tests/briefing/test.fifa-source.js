//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: test.fifa-source.js
//  Description: Tests for the source a reader joins to their choice on the map of the FIFA presidency (fifa-source.js): the address as it is kept, the passages of the page that
//               name the association and the candidate, and what the page says compared with what the reader chose. Pure: no page is fetched
//

import {describe, expect, it} from '@jest/globals';
import {MEMBERS, MEMBER_LIST, memberOfFifa} from '../../services/utils/fifa-members.js';
import {aliasIndexOf} from '../../services/utils/fifa-passages.js';
import {checkOf, cleanSourceUrl, newsOfPage, passagesOfSource, sourceOfBody} from '../../services/utils/fifa-source.js';

const jp = memberOfFifa('JPN');
const den = memberOfFifa('DEN');
const SUBJECT = {qid: 'Q124138', name: 'Gianni Infantino', terms: ['infantino']};
const index = aliasIndexOf({members: MEMBER_LIST});
const URL_OF_PAGE = 'https://www.example.com/news/a';
const NOW = new Date('2026-11-12T12:00:00Z');
const page = (text, more = {}) => ({title: 'Football news', description: '', text, lang: 'en', publishedAt: '2026-11-10T08:00:00Z', ...more});
const passages = (text, member = jp) => passagesOfSource({page: page(text), url: URL_OF_PAGE, member, subject: SUBJECT, index, members: MEMBERS, now: NOW});

describe('cleanSourceUrl', () => {
    it('should keep an http or https address without its fragment, and trim it', () => {
        expect(cleanSourceUrl('  https://www.example.com/news/a?id=3#comments ')).toBe('https://www.example.com/news/a?id=3');
        expect(cleanSourceUrl('http://example.com')).toBe('http://example.com/');
    });

    it('should refuse what is not an address, another scheme, a name or password in it, and a long one, with a 422', () => {
        for (const value of ['', '   ', undefined, 'not an address', 'ftp://example.com/a', 'file:///etc/passwd', 'javascript:alert(1)', 'https://name:secret@example.com/a', `https://example.com/${'a'.repeat(500)}`]) {
            expect(() => cleanSourceUrl(value)).toThrow(expect.objectContaining({status: 422}));
        }
    });
});

describe('sourceOfBody', () => {
    it('should answer nothing when the reader joined none, and the address with its medium when they did (a string or {url})', () => {
        for (const value of [undefined, null, '']) expect(sourceOfBody(value)).toBeNull();
        expect(sourceOfBody('https://www.bbc.co.uk/sport/a')).toEqual({url: 'https://www.bbc.co.uk/sport/a', medium: 'bbc.co.uk'});
        expect(sourceOfBody({url: 'https://edition.cnn.com/b'})).toEqual({url: 'https://edition.cnn.com/b', medium: 'cnn.com'});
        expect(() => sourceOfBody({})).toThrow(expect.objectContaining({status: 422}));
    });
});

describe('newsOfPage', () => {
    it('should make one news of the pipeline of the page, dated by the page unless the date is wrong or in the future', () => {
        expect(newsOfPage({page: page('A | B'), url: URL_OF_PAGE, now: NOW})).toMatchObject({id: 'source', lang: 'en', medium: 'example.com', link: URL_OF_PAGE, at: new Date('2026-11-10T08:00:00Z')});
        expect(newsOfPage({page: page('A', {publishedAt: 'yesterday-ish'}), url: URL_OF_PAGE, now: NOW}).at).toEqual(NOW);
        expect(newsOfPage({page: page('A', {publishedAt: '2030-01-01'}), url: URL_OF_PAGE, now: NOW}).at).toEqual(NOW);
        expect(newsOfPage({page: page('A', {lang: 'pt-BR'}), url: URL_OF_PAGE, now: NOW}).lang).toBe('pt');
        expect(newsOfPage({page: page('A', {lang: null}), url: URL_OF_PAGE, now: NOW}).lang).toBeNull();
    });
});

describe('passagesOfSource', () => {
    it('should find the sentences that name the association and the candidate, by its name and by its acronym (the reader says the page is about it)', () => {
        const found = passages(`The ${jp.association} will back Infantino for a new term. The weather was fine in Tokyo. The JFA president met Infantino on Tuesday.`);
        expect(found).toHaveLength(2);
        expect(found.every(passage => passage.member.qid === jp.qid && passage.article.url === URL_OF_PAGE)).toBe(true);
    });

    it('should leave out the sentences of another association, and the sentences without the candidate', () => {
        expect(passages(`The ${den.association} will back Infantino. The ${jp.association} held a meeting.`)).toHaveLength(0);
        expect(passages(`The ${den.association} will back Infantino. The ${jp.association} will back Infantino.`).map(passage => passage.member.fifa)).toEqual(['JPN']);
    });

    it('should read at most six passages, the ones with a word of support or opposition first', () => {
        const filler = Array.from({length: 8}, (_, at) => `The ${jp.association} met Infantino for the ${at + 1}th time.`);
        const text = [...filler, `The ${jp.association} will oppose Infantino at the congress.`].join(' ');
        const found = passages(text);
        expect(found).toHaveLength(6);
        expect(found[0].sentence).toContain('oppose');
    });
});

describe('checkOf', () => {
    const one = (stance, more = {}, sentence = 'The JFA will back Infantino.') => ({passage: {sentence}, reading: {status: 'established', stance, level: 'probable', ...more}});

    it('should say the page SAYS it when an established reading is on the side of the reader, with the sentence, the declared one first', () => {
        const answer = checkOf({expected: 'for', readings: [one('for', {}, 'Probable sentence.'), one('for', {level: 'declared'}, 'Declared sentence.'), one('against')]});
        expect(answer).toEqual({check: 'says', found: 'Declared sentence.'});
    });

    it('should say it CONTRADICTS when the only established readings are on the other side', () => {
        expect(checkOf({expected: 'for', readings: [one('against', {}, 'It will not back him.')]})).toEqual({check: 'contradicts', found: 'It will not back him.'});
        expect(checkOf({expected: 'against', readings: [one('for', {}, 'It will back him.')]})).toEqual({check: 'contradicts', found: 'It will back him.'});
    });

    it('should say UNCLEAR when nothing is established: uncertain, discarded or no reading at all', () => {
        expect(checkOf({expected: 'for', readings: [{passage: {sentence: 's'}, reading: {status: 'uncertain', stance: 'for', level: 'probable'}}, {passage: {sentence: 's'}, reading: {status: 'discarded', stance: 'none'}}]}))
            .toEqual({check: 'unclear', found: ''});
        expect(checkOf({expected: 'for', readings: []})).toEqual({check: 'unclear', found: ''});
    });

    it('should answer nothing when every reading failed, so the check is made again later', () => {
        expect(checkOf({expected: 'for', readings: [{passage: {sentence: 's'}, reading: {unreadable: true}}, {passage: {sentence: 's'}, reading: {unreadable: true}}]})).toBeNull();
        // one reading is enough to tell
        expect(checkOf({expected: 'for', readings: [{passage: {sentence: 's'}, reading: {unreadable: true}}, one('for')]})).toMatchObject({check: 'says'});
    });
});
