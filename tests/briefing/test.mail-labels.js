//
//  Author: Fabian Rostello
//  Date: 18.10.2026
//  File: test.mail-labels.js
//  Description: The words of the e-mail in the reader's language, translated once per language, left in
//               English when the AI does not answer or loses a value to put in
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const translateTexts = jest.fn();
const kept = jest.fn(async () => new Map());
const keep = jest.fn(async () => 0);
jest.unstable_mockModule('../../models/mail-label-model.js', () => ({MailLabelModel: {of: kept, save: keep}}));
const extract = await import('../../services/utils/extract.js');
jest.unstable_mockModule('../../services/utils/extract.js', () => ({...extract, translateTexts}));
const {labelsFor, withHedgedTranslated} = await import('../../services/utils/mail-labels.js');
const {LABELS} = await import('../../services/utils/briefing-mail.js');

const FRENCH = {'Contested': 'Contesté', '{by} denies:': '{by} dément :', 'told by {count} media': 'raconté par des médias'};

beforeEach(() => {
    translateTexts.mockReset();
    kept.mockReset().mockResolvedValue(new Map());
    keep.mockReset().mockResolvedValue(0);
});

describe('labelsFor', () => {
    it('should ask the AI nothing for an English reader', async () => {
        expect(await labelsFor('en')).toBe(LABELS);
        expect(translateTexts).not.toHaveBeenCalled();
    });

    it('should translate the words once per language, a translation without its values left in English', async () => {
        translateTexts.mockImplementation(async (texts) => texts.map(({text}) => FRENCH[text] ?? null));
        const labels = await labelsFor('fr');
        expect(translateTexts.mock.calls[0][1]).toBe('French');
        expect(labels).toMatchObject({contested: 'Contesté', denies: '{by} dément :', toldBy: 'told by {count} media', keyPoints: 'Key points'});
        expect(await labelsFor('fr')).toBe(labels);
        expect(translateTexts).toHaveBeenCalledTimes(1);
    });

    it('should leave them in English when the AI does not answer, and ask again next time', async () => {
        translateTexts.mockRejectedValueOnce(new Error('down')).mockImplementationOnce(async (texts) => texts.map(() => null));
        expect(await labelsFor('de')).toBe(LABELS);
        expect(await labelsFor('de')).toBe(LABELS);
        expect(translateTexts).toHaveBeenCalledTimes(2);
    });
});

// the words the AI translated are kept: the e-mail says the same ones from one session to the next (the user, 2.11.2026)
describe('labelsFor and the translations kept', () => {
    it('should keep the good translations, and not the one that lost its values', async () => {
        translateTexts.mockImplementation(async (texts) => texts.map(({text}) => FRENCH[text] ?? null));
        await labelsFor('it');
        expect(keep).toHaveBeenCalledTimes(1);
        expect(keep.mock.calls[0][0]).toBe('it');
        expect(keep.mock.calls[0][1]).toEqual([{source: 'Contested', translation: 'Contesté'}, {source: '{by} denies:', translation: '{by} dément :'}]);
    });

    it('should ask the AI only for the words that have no translation kept, and use the others as they were kept', async () => {
        const keys = Object.keys(LABELS);
        // all kept but two: a word of the code the AI never translated, and "Contested", which the AI lost last time
        const saved = new Map(keys.filter(key => !['contested', 'otherAngle'].includes(key)).map(key => [LABELS[key], `fr: ${LABELS[key]}`]));
        // a kept translation that lost a value is not used
        saved.set(LABELS.denies, 'dément');
        kept.mockResolvedValue(saved);
        translateTexts.mockImplementation(async (texts) => texts.map(({text}) => FRENCH[text] ?? null));

        const labels = await labelsFor('es');
        expect(translateTexts.mock.calls[0][0].map(({text}) => text).sort()).toEqual(['Contested', 'Other angle:', '{by} denies:'].sort());
        expect(labels.keyPoints).toBe('fr: Key points');
        expect(labels.contested).toBe('Contesté');
        expect(labels.denies).toBe('{by} dément :');
        expect(labels.otherAngle).toBe('Other angle:');
        // only the words translated now are kept
        expect(keep.mock.calls[0][1].map(row => row.source).sort()).toEqual(['Contested', '{by} denies:']);
    });

    it('should not ask the AI at all when every word has its translation kept', async () => {
        kept.mockResolvedValue(new Map(Object.values(LABELS).map(text => [text, `pt: ${text}`])));
        const labels = await labelsFor('pt');
        expect(translateTexts).not.toHaveBeenCalled();
        expect(keep).not.toHaveBeenCalled();
        expect(labels.keyPoints).toBe('pt: Key points');
        expect(labels.briefingOf).toBe('pt: {name}’s Briefing');
    });

    it('should translate them all when the database does not answer, and say the same when it will not keep them', async () => {
        const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
        kept.mockRejectedValue(new Error('database down'));
        keep.mockRejectedValue(new Error('database down'));
        translateTexts.mockImplementation(async (texts) => texts.map(({text}) => FRENCH[text] ?? null));
        const labels = await labelsFor('nl');
        expect(translateTexts.mock.calls[0][0]).toHaveLength(Object.keys(LABELS).length);
        expect(labels.contested).toBe('Contesté');
        quiet.mockRestore();
    });

    it('should leave them in English, nothing kept, when none is translated, and ask again next time', async () => {
        translateTexts.mockImplementation(async (texts) => texts.map(() => null));
        expect(await labelsFor('sv')).toBe(LABELS);
        expect(await labelsFor('sv')).toBe(LABELS);
        expect(translateTexts).toHaveBeenCalledTimes(2);
        expect(keep).not.toHaveBeenCalled();
    });
});

describe('withHedgedTranslated', () => {
    it("should translate the words of an article in another language than the reader's only", async () => {
        translateTexts.mockResolvedValueOnce(['selon des sources']);
        const items = [{storyId: 1, hedged: 'reportedly', language: 'en'}, {storyId: 2, hedged: 'selon nos informations', language: 'fr'}, {storyId: 3, language: 'de'}];
        expect(await withHedgedTranslated(items, 'fr')).toEqual([{...items[0], hedgedTranslation: 'selon des sources'}, items[1], items[2]]);
        expect(translateTexts).toHaveBeenCalledWith([{text: 'reportedly', from: 'English'}], 'French', null);
    });

    // translated when the briefing is written (the page shows it too): not asked again when its e-mail is sent
    it('should not translate again the words a card has translated already', async () => {
        const items = [{storyId: 1, hedged: 'reportedly', language: 'en', hedgedTranslation: 'selon des sources'}];
        expect(await withHedgedTranslated(items, 'fr')).toEqual(items);
        expect(translateTexts).not.toHaveBeenCalled();
    });
});

// the editor of the e-mail asks for its preview at each change: the AI is asked for the same words once (the user, 5.11.2026)
describe('labelsFor and withHedgedTranslated asked again and again', () => {
    it('should ask the AI once for a language when the previews ask together, and give them the same words', async () => {
        translateTexts.mockImplementation(async (texts) => {
            await new Promise(resolve => setTimeout(resolve, 20));
            return texts.map(({text}) => FRENCH[text] ?? null);
        });
        const [first, second] = await Promise.all([labelsFor('da'), labelsFor('da')]);
        expect(second).toBe(first);
        expect(translateTexts).toHaveBeenCalledTimes(1);
        expect(await labelsFor('da')).toBe(first);
        expect(translateTexts).toHaveBeenCalledTimes(1);
    });

    it('should translate the words of a card once, and use them for the next previews', async () => {
        translateTexts.mockResolvedValueOnce(['dem Vernehmen nach']);
        const items = [{storyId: 1, hedged: 'allegedly', language: 'en'}];
        expect(await withHedgedTranslated(items, 'de')).toEqual([{...items[0], hedgedTranslation: 'dem Vernehmen nach'}]);
        expect(await withHedgedTranslated(items, 'de')).toEqual([{...items[0], hedgedTranslation: 'dem Vernehmen nach'}]);
        expect(translateTexts).toHaveBeenCalledTimes(1);
        // another language, other words
        translateTexts.mockResolvedValueOnce(['presuntamente']);
        expect((await withHedgedTranslated(items, 'es'))[0].hedgedTranslation).toBe('presuntamente');
        expect(translateTexts).toHaveBeenCalledTimes(2);
    });

    it('should ask again for the words the AI did not translate', async () => {
        translateTexts.mockResolvedValueOnce([null]).mockResolvedValueOnce(['à ce qu’il paraît']);
        const items = [{storyId: 1, hedged: 'apparently', language: 'en'}];
        expect((await withHedgedTranslated(items, 'fr'))[0].hedgedTranslation).toBeNull();
        expect((await withHedgedTranslated(items, 'fr'))[0].hedgedTranslation).toBe('à ce qu’il paraît');
        expect(translateTexts).toHaveBeenCalledTimes(2);
    });
});
