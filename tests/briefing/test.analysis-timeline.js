//
//  Author: Fabian Rostello
//  Date: 06.11.2026
//  File: test.analysis-timeline.js
//  Description: "The story so far" of the analysis of a card, the earlier news of its affair: their titles in the language of the
//               reader, the language of each read from its letters as well as from its label (two Serbian titles in Cyrillic of a
//               card of 6.11.2026 stayed untranslated: the words alone know no Cyrillic)
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const earlierInThreads = jest.fn();
const ollamaJson = jest.fn();
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
jest.unstable_mockModule('../../models/story-model.js', () => ({StoryModel: {earlierInThreads, articlesOfLinks: jest.fn(async () => []), storyArticles: jest.fn(async () => [])}}));
const ollama = await import('../../services/utils/ollama.js');
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({...ollama, ollamaJson}));
const analysesOf = jest.fn(async (cards) => ({picked: [], cards: Object.fromEntries(cards.map(card => [card.storyId, {why: ['Why it matters.'], next: [], dropped: 0}]))}));
const cardAnalysis = await import('../../services/utils/card-analysis.js');
jest.unstable_mockModule('../../services/utils/card-analysis.js', () => ({...cardAnalysis, analysesOf}));
const {cardAnalyses} = await import('../../services/briefing-service.js');

const CYRILLIC = 'БЕЗ ПОДНЕТИХ КАНДИДАТУРА ЗА ПРЕДСЕДНИКА И ЧЛАНОВЕ ИЗВРШНОГ ОДБОРА ФСС';
const LATIN = 'Elections when it is not their time';
const row = (id, title, lang, day) => ({card: 1, id, created_at: new Date(`2026-11-0${day}T10:00:00Z`), lang, title, medium: 'fss.rs', link: `https://fss.rs/${id}`});
const item = {storyId: 1, title: 'A title', summary: 'A passage.', lead: {source: 'nova.rs'}, articles: []};

// the AI answers one translation per text, "T:" and the title
beforeEach(() => {
    earlierInThreads.mockReset();
    ollamaJson.mockReset().mockImplementation(async (prompt) => ({
        translations: [...prompt.matchAll(/^\[\d+\] \([^)]*\) (.*)$/gm)].map(match => `T: ${match[1]}`),
    }));
});

describe('cardAnalyses, the story so far', () => {
    it('should translate a title in Cyrillic, which the words alone cannot read, as one in Latin letters', async () => {
        earlierInThreads.mockResolvedValue([row(11, CYRILLIC, 'sr', 2), row(12, LATIN, 'en', 1)]);
        const {cards} = await cardAnalyses([item], new Map([[1, [{title: 'x'}]]]), 'en');
        const timeline = cards[1].timeline;
        expect(timeline).toHaveLength(2);
        const cyrillic = timeline.find(one => one.title === CYRILLIC);
        expect(cyrillic.titleTranslation).toBe(`T: ${CYRILLIC}`);
        // a title in the language of the reader stays as it is
        expect(timeline.find(one => one.title === LATIN).titleTranslation).toBeNull();
        // the label used to read it does not leave with it
        expect(Object.keys(cyrillic)).not.toContain('label');
    });

    it('should translate a Cyrillic title whose story has the label of its feed, English, as the Persian ones are', async () => {
        earlierInThreads.mockResolvedValue([row(11, CYRILLIC, 'en', 2)]);
        const {cards} = await cardAnalyses([item], new Map([[1, [{title: 'x'}]]]), 'en');
        expect(cards[1].timeline[0].titleTranslation).toBe(`T: ${CYRILLIC}`);
    });

    it('should keep only the stories created before the card: the same day, or after it, is no history of it', async () => {
        // the card (story 1) was created on 11-05 at 10:00: what is of 11-03 and 11-02 is earlier, what is of 11-05 later in the day or of 11-06 is not
        const at = (id, day, hour) => ({...row(id, `Title of ${id}`, 'en', 1), created_at: new Date(`2026-11-${day}T${hour}:00:00Z`), card_at: new Date('2026-11-05T10:00:00Z')});
        earlierInThreads.mockResolvedValue([at(11, '06', '09'), at(12, '05', '14'), at(13, '05', '08'), at(14, '03', '10'), at(15, '02', '10')]);
        const {cards} = await cardAnalyses([item], new Map([[1, [{title: 'x'}]]]), 'en');
        expect(cards[1].timeline.map(one => one.title)).toEqual(['Title of 15', 'Title of 14', 'Title of 13']);
    });

    it('should keep every story when the database does not say when the card was created (the older rows of a bench)', async () => {
        earlierInThreads.mockResolvedValue([row(11, LATIN, 'en', 2)]);
        const {cards} = await cardAnalyses([item], new Map([[1, [{title: 'x'}]]]), 'en');
        expect(cards[1].timeline).toHaveLength(1);
    });

    it('should leave the titles as they are when the AI cannot translate them: the card is never kept waiting', async () => {
        earlierInThreads.mockResolvedValue([row(11, CYRILLIC, 'sr', 2)]);
        ollamaJson.mockRejectedValue(new Error('down'));
        const {cards} = await cardAnalyses([item], new Map([[1, [{title: 'x'}]]]), 'en');
        expect(cards[1].timeline[0]).toMatchObject({title: CYRILLIC, titleTranslation: null});
    });
});
