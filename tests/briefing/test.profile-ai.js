//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: test.profile-ai.js
//  Description: Tests for the reading of the answers of the AI for a profile and a briefing
//

import {jest} from '@jest/globals'

// the AI is never called by these tests, only its answers are read
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson: jest.fn()}));
const {normalizeCheck, normalizeInterests, normalizeMerges, normalizeReview, normalizeSelection, parseSearch, reviewPrompt} = await import('../../services/utils/profile-ai.js');

const options = {languages: ['fr', 'en'], categories: ['world', 'sport', 'technology']};

describe('normalizeInterests', () => {
    it('should keep the interests as the AI gave them when they are right', () => {
        const [interest] = normalizeInterests({interests: [{
            text: 'Rugby : Top 14, Six Nations', weight: 1, keywords: 'rugby, Top 14',
            searches: [{q: 'Top 14', lang: 'fr'}, {q: 'Six Nations', lang: 'en'}],
            sections: ['rugby', 'rugby'], category: 'sport',
        }]}, options);

        expect(interest).toEqual({
            text: 'Rugby : Top 14, Six Nations', weight: 1, keywords: 'rugby, Top 14',
            searches: ['fr:Top 14', 'en:Six Nations'], sections: ['rugby'], category: 'sport',
        });
    });

    it('should correct what the AI gets wrong', () => {
        const [interest] = normalizeInterests({interests: [{
            text: '  Chefs   cuisiniers ', weight: 7, keywords: 'chef biographie / chef biography',
            searches: [{q: 'chef', lang: 'fr'}, {q: 'chef étoilé', lang: 'fr'}, {q: 'cuoco', lang: 'fr'}, {q: 'koch', lang: 'de'}, {q: '', lang: 'en'}],
            category: 'cuisine',
        }]}, options);

        expect(interest.text).toBe('Chefs cuisiniers');
        expect(interest.weight).toBe(1);
        expect(interest.keywords).toBe('chef biographie, chef biography');
        expect(interest.searches).toEqual(['fr:chef', 'fr:chef étoilé']);       // 2 per language read, none in German
        expect(interest.category).toBe('world');
        expect(interest.sections).toEqual([]);
    });

    it('should drop the interests without a text and keep six at most', () => {
        const many = Array.from({length: 9}, (_, i) => ({text: `Sujet ${i}`}));
        expect(normalizeInterests({interests: [{text: ''}, ...many]}, options)).toHaveLength(6);
        expect(normalizeInterests(null, options)).toEqual([]);
    });
});

describe('parseSearch', () => {
    it('should read back a search kept with its language', () => {
        expect(parseSearch('fr:Top 14')).toEqual({lang: 'fr', q: 'Top 14'});
        expect(parseSearch('Top 14')).toBeNull();
    });
});

describe('normalizeSelection', () => {
    it('should keep the stories given, once each, in the order of the AI', () => {
        const selected = normalizeSelection({selected: [
            {id: '12', why: 'Du rugby'}, {id: '[7]', why: 'La mode'}, {id: '12', why: 'encore'}, {id: '99', why: 'inventée'},
        ]}, ['7', '12', '30']);
        expect(selected).toEqual([{id: '12', why: 'Du rugby'}, {id: '7', why: 'La mode'}]);
    });

    it('should accept an empty choice: no story fits', () => {
        expect(normalizeSelection({selected: []}, ['1'])).toEqual([]);
        expect(normalizeSelection({}, ['1'])).toEqual([]);
    });
});

describe('normalizeCheck', () => {
    const stories = [
        {id: '12', lead: {title: 'Meta lance Muse Charm'}, others: [{title: 'Le Muse Charm dévoilé'}, {title: 'Un bug dans Muse'}, {title: 'Muse Charm : le prix'}]},
        {id: '7', lead: {title: 'Toulouse bat La Rochelle'}, others: [{title: 'Toulon bat Pau'}]},
        {id: '30', lead: {title: 'Budget 2027'}, others: [{title: 'Le budget adopté'}]},
    ];

    it('should keep, for each story answered, the articles telling the news of the lead one', () => {
        const checked = normalizeCheck({stories: [{id: '12', same: [1, 3]}, {id: '[7]', same: []}]}, stories);
        expect(checked.get('12')).toEqual(new Set([1, 3]));
        expect(checked.get('7')).toEqual(new Set());            // nothing tells the same: the lead alone
        expect(checked.has('30')).toBe(false);                  // not answered: shown as grouped
    });

    it('should drop what the AI invents: unknown stories, numbers out of the list, a story twice', () => {
        const checked = normalizeCheck({stories: [
            {id: '99', same: [1]}, {id: '12', same: [0, 2, 4, '3', 2.5, 'x']}, {id: '12', same: [1]}, {id: '30', same: 'all'},
        ]}, stories);
        expect(checked.get('12')).toEqual(new Set([2, 3]));
        expect(checked.get('30')).toEqual(new Set());
        expect(checked.has('99')).toBe(false);
        expect(normalizeCheck(null, stories).size).toBe(0);
    });
});

describe('normalizeMerges', () => {
    const stories = [
        {id: '3641', lead: {title: 'Manchester City found guilty on 114 charges'}},
        {id: '6628', lead: {title: 'What could the sanctions for Man City be?'}},
        {id: '4220', lead: {title: 'FA Cup tie replayed after a referee error'}},
        {id: '5120', lead: {title: 'Man City 115 charges timeline'}},
    ];

    it('should join a card to the first card of the same news above it, a chain included', () => {
        const merges = normalizeMerges({stories: [
            {id: '3641', sameAs: null}, {id: '6628', sameAs: '3641'}, {id: '4220', sameAs: null}, {id: '[5120]', sameAs: '[6628]'},
        ]}, stories);
        expect(merges).toEqual(new Map([['6628', '3641'], ['5120', '3641']]));
    });

    it('should drop a card joined to a card below it, to itself or to an unknown one', () => {
        const merges = normalizeMerges({stories: [
            {id: '3641', sameAs: '6628'}, {id: '6628', sameAs: '6628'}, {id: '4220', sameAs: '99'}, {id: '5120', sameAs: 4220},
        ]}, stories);
        expect(merges).toEqual(new Map([['5120', '4220']]));    // a number answered for the id counts
        expect(normalizeMerges(null, stories).size).toBe(0);
    });
});

describe('normalizeMerges with the cards already shown', () => {
    const shown = [{id: 'shown0', lead: {title: 'Man City 115 charges timeline'}}, {id: 'shown1', lead: {title: 'City: the charges'}}];
    const stories = [{id: '8', lead: {title: 'Manchester City reconnu coupable'}}, {id: '9', lead: {title: 'Galliani à la FIGC ?'}}];

    it('should drop a story of the day telling a shown news, and not answer for the shown cards', () => {
        const merges = normalizeMerges({stories: [
            {id: 'shown1', sameAs: 'shown0'}, {id: '8', sameAs: 'shown1'}, {id: '9', sameAs: null},
        ]}, stories, shown);
        expect(merges).toEqual(new Map([['8', 'shown1']]));
    });
});

describe('the cards read again with their summary', () => {
    it('should leave out only cards of the briefing, each once', () => {
        const refused = normalizeReview({refused: [
            {id: '[8234]', why: "L'article traite de l'équipe nationale de football."},
            {id: '8234', why: 'twice'},
            {id: '999', why: 'not a card of this briefing'},
            {why: 'no id'},
        ]}, ['8234', '12307']);
        expect(refused).toEqual(new Map([['8234', "L'article traite de l'équipe nationale de football."]]));
        expect(normalizeReview({refused: 'nothing'}, ['1'])).toEqual(new Map());
        expect(normalizeReview(null, ['1'])).toEqual(new Map());
    });

    it('should give the AI the summary of each card, and say when there is none', () => {
        const prompt = reviewPrompt("Le football ne m'intéresse pas du tout.", [
            {id: '8234', title: 'Une nouvelle Nati', summary: "L'équipe nationale de Suisse de football débute à Skopje."},
            {id: '1090', title: 'Anthropic Science Lab', summary: null},
        ]);
        expect(prompt).toContain("[8234] Une nouvelle Nati\nL'équipe nationale de Suisse de football débute à Skopje.");
        expect(prompt).toContain('[1090] Anthropic Science Lab\n(pas de résumé)');
        expect(prompt).toContain("S'il n'écrit rien de tel, n'enlève aucune carte.");
    });
});
