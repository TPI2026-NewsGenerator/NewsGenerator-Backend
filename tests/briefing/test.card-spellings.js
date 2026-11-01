//
//  Author: Fabian Rostello
//  Date: 02.11.2026
//  File: test.card-spellings.js
//  Description: Tests for how Wikidata spells the names of the news of a card: the names the tagger linked,
//               their label in English, the ones a translation is told of
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const linkedNamesOf = jest.fn();
jest.unstable_mockModule('../../models/mention-model.js', () => ({MentionModel: {linkedNamesOf}}));
const describeItems = jest.fn();
jest.unstable_mockModule('../../services/utils/wikidata.js', () => ({describeItems}));

const {glossariesOfStories} = await import('../../services/utils/card-spellings.js');

const story = (storyId, ...ids) => ({storyId, members: ids.map(id => ({id}))});
const row = (id_article, name, qid) => ({id_article, name, kind: 'person', qid});

beforeEach(() => {
    linkedNamesOf.mockReset();
    describeItems.mockReset();
});

describe('glossariesOfStories', () => {
    it('should give each story the names of its news that are an item of Wikidata, written as the news do and spelled as it does', async () => {
        linkedNamesOf.mockResolvedValue([row(1, 'Φραπάρ', 'Q1'), row(2, 'Φραπάρ', 'Q1'), row(2, 'Λανουά', 'Q2'), row(3, 'Mbappé', 'Q3')]);
        describeItems.mockResolvedValue([{qid: 'Q1', label: 'Stéphanie Frappart'}, {qid: 'Q2', label: 'Stéphane Lannoy'}, {qid: 'Q3', label: 'Kylian Mbappé'}]);
        const glossaries = await glossariesOfStories([story(10, 1, 2), story(11, 3)]);
        // the most named first, each to its own story
        expect(glossaries.get(10)).toEqual({
            glossary: [{written: 'Φραπάρ', spelled: 'Stéphanie Frappart'}, {written: 'Λανουά', spelled: 'Stéphane Lannoy'}],
            names: ['Stéphanie Frappart', 'Stéphane Lannoy']});
        // a name written as its label is no pair to tell, but its spelling is one the card has
        expect(glossaries.get(11)).toEqual({glossary: [{written: 'Mbappé', spelled: 'Kylian Mbappé'}], names: ['Kylian Mbappé']});
    });

    it('should give the spelling of a name another medium of the card writes in Latin letters, with no pair to tell', async () => {
        linkedNamesOf.mockResolvedValue([row(1, 'Στεφάν Λανουά', 'Q201'), row(2, 'Stéphane Lannoy', 'Q201'), row(2, 'Stéphane Lannoy', 'Q201')]);
        describeItems.mockResolvedValue([{qid: 'Q201', label: 'Stéphane Lannoy'}]);
        expect((await glossariesOfStories([story(10, 1, 2)])).get(10))
            .toEqual({glossary: [{written: 'Στεφάν Λανουά', spelled: 'Stéphane Lannoy'}], names: ['Stéphane Lannoy']});
    });

    it('should leave out a name written as its label, one with no label in English, and one in another alphabet', async () => {
        // other items than the test before: the labels are kept for a week
        linkedNamesOf.mockResolvedValue([row(1, 'Stéphanie Frappart', 'Q101'), row(1, 'Λανουά', 'Q102'), row(1, 'Ζεγκέλ', 'Q103'), row(1, 'Σαλάχ', 'Q104')]);
        describeItems.mockResolvedValue([{qid: 'Q101', label: 'Stéphanie Frappart'}, {qid: 'Q102', label: 'Q102'}, {qid: 'Q103', label: '桑格尔'}, {qid: 'Q104', label: 'Mohamed Salah'}]);
        expect((await glossariesOfStories([story(10, 1)])).get(10)).toEqual({
            glossary: [{written: 'Σαλάχ', spelled: 'Mohamed Salah'}], names: ['Stéphanie Frappart', 'Mohamed Salah']});
    });

    it('should ask Wikidata once for the items it does not know, and remember the labels', async () => {
        linkedNamesOf.mockResolvedValue([row(5, 'Σαλάχ', 'Q9001')]);
        describeItems.mockResolvedValue([{qid: 'Q9001', label: 'Mohamed Salah'}]);
        await glossariesOfStories([story(20, 5)]);
        await glossariesOfStories([story(20, 5)]);
        expect(describeItems).toHaveBeenCalledTimes(1);
        expect(describeItems).toHaveBeenCalledWith(['Q9001'], expect.objectContaining({background: true}));
    });

    it('should give nothing when the database or Wikidata does not answer: the briefing never waits on it', async () => {
        const error = jest.spyOn(console, 'error').mockImplementation(() => {});
        linkedNamesOf.mockResolvedValue([row(1, 'Φραπάρ', 'Q8001')]);
        describeItems.mockRejectedValue(new Error('Wikidata asked to wait.'));
        expect((await glossariesOfStories([story(10, 1)])).size).toBe(0);
        linkedNamesOf.mockRejectedValue(new Error('connection lost'));
        expect((await glossariesOfStories([story(10, 1)])).size).toBe(0);
        error.mockRestore();
    });

    it('should not ask anything of a briefing without a story', async () => {
        linkedNamesOf.mockResolvedValue([]);
        expect((await glossariesOfStories([])).size).toBe(0);
    });
});
