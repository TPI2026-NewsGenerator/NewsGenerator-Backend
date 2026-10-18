//
//  Author: Fabian Rostello
//  Date: 18.10.2026
//  File: test.mail-labels.js
//  Description: The words of the e-mail in the reader's language, translated once per language, left in
//               English when the AI does not answer or loses a value to put in
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const translateTexts = jest.fn();
const extract = await import('../../services/utils/extract.js');
jest.unstable_mockModule('../../services/utils/extract.js', () => ({...extract, translateTexts}));
const {labelsFor, withHedgedTranslated} = await import('../../services/utils/mail-labels.js');
const {LABELS} = await import('../../services/utils/briefing-mail.js');

const FRENCH = {'Contested': 'Contesté', '{by} denies:': '{by} dément :', 'told by {count} media': 'raconté par des médias'};

beforeEach(() => translateTexts.mockReset());

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

describe('withHedgedTranslated', () => {
    it("should translate the words of an article in another language than the reader's only", async () => {
        translateTexts.mockResolvedValueOnce(['selon des sources']);
        const items = [{storyId: 1, hedged: 'reportedly', language: 'en'}, {storyId: 2, hedged: 'selon nos informations', language: 'fr'}, {storyId: 3, language: 'de'}];
        expect(await withHedgedTranslated(items, 'fr')).toEqual([{...items[0], hedgedTranslation: 'selon des sources'}, items[1], items[2]]);
        expect(translateTexts).toHaveBeenCalledWith([{text: 'reportedly', from: 'English'}], 'French', null);
    });
});
