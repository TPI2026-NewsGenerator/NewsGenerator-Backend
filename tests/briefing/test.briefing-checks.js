//
//  Author: Fabian Rostello
//  Date: 09.11.2026
//  File: test.briefing-checks.js
//  Description: The checks of the cards of a briefing that the server runs after writing it (briefing-checks.js): what each one finds, and
//               that the log never fails nor changes the briefing
//

import {describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('ollama', () => ({Ollama: jest.fn(() => ({chat: jest.fn()}))}));
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const {cardChecks, logBriefingChecks, logPictureChecks, pictureLoadChecks} = await import('../../services/utils/briefing-checks.js');

const card = (changes = {}) => ({storyId: 1, title: 'The federation names a new referee', language: 'en', summary: 'The federation named a new referee on Monday for the final.',
    points: 'The federation named a new referee on Monday for the final.', thumbnail: 'https://media.example/p.jpg', ...changes});
const broken = (items, name) => cardChecks(items, 'en').find(([title]) => title === name)[1];
const names = (items) => cardChecks(items, 'en').filter(([, list]) => list.length > 0).map(([name]) => name);

describe('cardChecks', () => {
    it('should hold for a card in the language of the reader with nothing in it that is not the article', () => {
        expect(names([card()])).toEqual([]);
    });

    it('should find the title of a card in another language that is not translated, and a text in letters that are not the reader’s', () => {
        const persian = card({language: 'en', title: 'اطلاعیه شماره ۶ صدور مجوز باشگاهی', summary: 'به گزارش سایت رسمی فدراسیون فوتبال، فیفا در گزارشی با اشاره به نتایج درخشان دختران فوتسالیست ایران، از این تیم یاد کرد.'});
        expect(broken([persian], 'no text a reader sees is written in another language than theirs').length).toBeGreaterThanOrEqual(2);
        const german = card({language: 'de', title: 'Der Verband ernennt einen neuen Schiedsrichter', summary: 'Der Verband hat am Montag einen neuen Schiedsrichter ernannt.'});
        expect(broken([german], 'the title of a card in another language is translated')).toHaveLength(1);
        expect(broken([german], 'the text of a card in another language is translated')).toHaveLength(1);
        expect(broken([{...german, titleTranslation: 'The federation names a referee', translation: 'x', points: null}], 'the title of a card in another language is translated')).toHaveLength(0);
    });

    it('should find a key point that begins with a dateline or is the caption of a photo, and a title with the label of a paywall', () => {
        expect(broken([card({points: 'ZURICH: Arsene Wenger’s offside trial is unlikely to be extended after receiving a report.'})], 'no key point begins with a dateline')).toHaveLength(1);
        expect(broken([card({points: 'WALVIS BAY – The ports authority has called on the federation to account for every dollar.'})], 'no key point begins with a dateline')).toHaveLength(1);
        const caption = 'EAST RUTHERFORD, NEW JERSEY - JULY 19: U.S. President Donald Trump and FIFA President Gianni Infantino hold the trophy at the ceremony.';
        expect(broken([card({points: caption})], 'no key point is the caption of a photo')).toHaveLength(1);
        expect(broken([card({title: 'The digital phantom goal: when technology in sport fails [premium]'})], 'no title keeps the label of a paywall')).toHaveLength(1);
    });

    it('should find the other sentences a reader sees that are written in another language than theirs: the line of the choice, the AI version, a denial, a statement', () => {
        const german = 'Der Verband hat am Montag einen neuen Schiedsrichter für das Finale ernannt, nachdem der Ausschuss lange beraten hatte.';
        const name = 'no other sentence a reader sees is written in another language than theirs';
        expect(broken([card()], name)).toHaveLength(0);
        expect(broken([card({why: german}), card({ai: {points: [german, 'The federation named a referee for the final on Monday.'], summary: null}}),
            card({contested: [{sentence: german, translation: null}]}), card({official: [{title: german, translation: null}]})], name)).toHaveLength(4);
        // translated, they are read in the language of the reader
        expect(broken([card({contested: [{sentence: german, translation: 'The federation named a referee for the final on Monday.'}],
            official: [{title: german, translation: 'The federation named a referee for the final on Monday.'}]})], name)).toHaveLength(0);
    });

    it('should find a name a reader sees written in the letters of another language: a chip of a card in Russian under an English text', () => {
        const name = 'no name a reader sees is written in the letters of another language than theirs';
        expect(broken([card({names: [{name: 'Gianni Infantino', qid: 'Q124138'}, {name: 'UEFA', qid: 'Q35572'}, {name: 'Čeferin', qid: null}]})], name)).toHaveLength(0);
        expect(broken([card({names: [{name: 'Джанни Инфантино', qid: 'Q124138'}, {name: 'Παναθηναϊκό', qid: null}]})], name)).toHaveLength(2);
        // read in Russian, they are the reader's own
        expect(cardChecks([card({names: [{name: 'ФИФА', qid: 'Q253414'}]})], 'ru').find(([title]) => title === name)[1]).toHaveLength(0);
    });

    it('should find a card with no picture and an angle whose language its title does not say', () => {
        expect(broken([card({thumbnail: null})], 'every card has a picture')).toHaveLength(1);
        expect(broken([card({angles: [{title: 'Der Verband ernennt einen neuen Schiedsrichter für das Finale am Montag', language: 'en', titleTranslation: 'x'}]})],
            'no angle has a language its title does not say')).toHaveLength(1);
    });
});

describe('pictureLoadChecks and logPictureChecks (the network)', () => {
    const log = () => ({log: jest.fn(), error: jest.fn()});
    const probeOf = (reasons) => jest.fn(async (url) => reasons[url]);
    const blocked = 'its site forbids the other sites to show it (Cross-Origin-Resource-Policy: same-site)';

    it('should name the cards whose picture a browser would show none of, with why, and leave out the ones it shows or that could not be told', async () => {
        const items = [card({storyId: 1, thumbnail: 'https://media.example/ok.jpg'}), card({storyId: 2, title: 'Law for sponsor changes after 32 years', thumbnail: 'https://editor.example/12.jpg'}),
            card({storyId: 3, thumbnail: 'https://slow.example/p.jpg'}), card({storyId: 4, thumbnail: null})];
        const probe = probeOf({'https://media.example/ok.jpg': null, 'https://editor.example/12.jpg': blocked, 'https://slow.example/p.jpg': undefined});
        const [[name, broken]] = await pictureLoadChecks(items, probe);
        expect(name).toBe('every picture a card shows loads on the page of a reader');
        expect(broken).toEqual([`Law for sponsor changes after 32 years: ${blocked}`]);
        expect(probe).toHaveBeenCalledTimes(3);
    });

    it('should ask each address once, whatever the number of cards that show it', async () => {
        const items = [card({storyId: 1, thumbnail: 'https://media.example/same.jpg'}), card({storyId: 2, thumbnail: 'https://media.example/same.jpg'})];
        const probe = probeOf({'https://media.example/same.jpg': 'the address answers 404'});
        const [[, broken]] = await pictureLoadChecks(items, probe);
        expect(broken).toHaveLength(2);
        expect(probe).toHaveBeenCalledTimes(1);
    });

    it('should say in the log that every picture loads, or which do not with their count and first example, and answer the ones that fail', async () => {
        const quiet = log();
        expect(await logPictureChecks(1407, [card()], quiet, probeOf({'https://media.example/p.jpg': null}))).toEqual([]);
        expect(quiet.log).toHaveBeenCalledWith('Briefing 1407: audit: every picture of the cards loads');
        // the addresses that could not be told are said, not taken for loading
        const unsure = log();
        await logPictureChecks(1407, [card()], unsure, probeOf({'https://media.example/p.jpg': undefined}));
        expect(unsure.log).toHaveBeenCalledWith('Briefing 1407: audit: every picture of the cards loads (1 could not be told)');
        const loud = log();
        const failed = await logPictureChecks(1407, [card({title: 'Law for sponsor changes after 32 years'})], loud, probeOf({'https://media.example/p.jpg': blocked}));
        expect(failed).toEqual([expect.objectContaining({name: 'every picture a card shows loads on the page of a reader', count: 1})]);
        expect(loud.error.mock.calls[0][0]).toContain(`Briefing 1407: audit: every picture a card shows loads on the page of a reader (1: Law for sponsor changes after 32 years: ${blocked})`);
    });

    it('should never throw: a probe that fails is a line in the log', async () => {
        const loud = log();
        expect(await logPictureChecks(1, [card()], loud, jest.fn(async () => { throw new Error('boom'); }))).toEqual([]);
        expect(loud.error.mock.calls[0][0]).toContain('the audit of the pictures failed');
    });
});

describe('logBriefingChecks', () => {
    const log = () => ({log: jest.fn(), error: jest.fn()});

    it('should say in the log that the checks hold, or which fail with their count and first example, and answer the ones that fail', () => {
        const quiet = log();
        expect(logBriefingChecks(508, [card()], 'en', quiet)).toEqual([]);
        expect(quiet.log).toHaveBeenCalledWith(expect.stringContaining('Briefing 508: audit: all the checks of the cards hold (1 cards)'));

        const loud = log();
        const failed = logBriefingChecks('unsaved', [card({thumbnail: null, points: 'ZURICH: Arsene Wenger’s offside trial is unlikely to be extended after receiving a report.'})], 'en', loud);
        expect(failed.map(one => one.name)).toEqual(['every card has a picture', 'no key point begins with a dateline']);
        expect(loud.error.mock.calls[0][0]).toContain('Briefing unsaved: audit: 2 checks of the cards fail: every card has a picture (1:');
        expect(loud.error.mock.calls[0][0]).toContain('no key point begins with a dateline');
    });

    it('should never throw: a card it cannot read is a line in the log, and the briefing is left as it is', () => {
        const loud = log();
        const items = [null];
        expect(logBriefingChecks(1, items, 'en', loud)).toEqual([]);
        expect(loud.error.mock.calls[0][0]).toContain('the audit of the cards failed');
        expect(items).toEqual([null]);
    });
});
