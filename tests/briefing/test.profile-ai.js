//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: test.profile-ai.js
//  Description: Tests for the reading of the answers of the AI for a profile and a briefing
//

import {jest} from '@jest/globals'

// the AI is never called by these tests, only its answers are read
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson: jest.fn()}));
const {ollamaJson} = await import('../../services/utils/ollama.js');
const {selectionPrompt} = await import('../../services/utils/profile-ai.js');
const {balanceSelection, confirmOnSubject, confirmPrompt, interestsOf, missingWords, normalizeCheck, normalizeInterests, normalizeMerges, normalizeReview, normalizeSelection, parseSearch, reviewPrompt} = await import('../../services/utils/profile-ai.js');

const options = {language: 'fr', categories: ['world', 'sport', 'technology']};

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
            searches: [{q: 'chef', lang: 'fr'}, {q: 'chef étoilé', lang: 'fr'}, {q: 'cuoco', lang: 'fr'}, {q: 'koch', lang: 'de'}, {q: '', lang: 'en'}, {q: 'chef', lang: 'xx'}],
            category: 'cuisine',
        }]}, options);

        expect(interest.text).toBe('Chefs cuisiniers');
        expect(interest.weight).toBe(1);
        expect(interest.keywords).toBe('chef biographie, chef biography');
        expect(interest.searches).toEqual(['fr:chef', 'fr:chef étoilé', 'de:koch']);   // 2 per language, none in a language Google has not
        expect(interest.category).toBe('world');
        expect(interest.sections).toEqual([]);
    });

    it('should drop the keywords and the searches of a year gone by, and keep the ones of this year or to come', () => {
        const year = new Date().getFullYear();
        const [interest] = normalizeInterests({interests: [{
            text: 'UEFA : compétitions', keywords: `UEFA, Euro ${year - 2}, Euro ${year + 2}, Ligue des champions ${year}`,
            searches: [{q: `Euro ${year - 2}`, lang: 'fr'}, {q: 'Ligue des champions', lang: 'fr'}],
        }]}, options);
        expect(interest.keywords).toBe(`UEFA, Euro ${year + 2}, Ligue des champions ${year}`);
        expect(interest.searches).toEqual(['fr:Ligue des champions']);
    });

    it('should search in four languages at most, the first ones the AI chose', () => {
        const [interest] = normalizeInterests({interests: [{
            text: 'Football européen', searches: ['fr', 'en', 'es', 'it', 'de'].map(lang => ({q: 'UEFA', lang})),
        }]}, options);
        expect(interest.searches).toEqual(['fr:UEFA', 'en:UEFA', 'es:UEFA', 'it:UEFA']);
    });

    it('should drop the interests without a text and keep six at most', () => {
        const many = Array.from({length: 9}, (_, i) => ({text: `Sujet ${i}`}));
        expect(normalizeInterests({interests: [{text: ''}, ...many]}, options)).toHaveLength(6);
        expect(normalizeInterests(null, options)).toEqual([]);
    });
});

describe('the words of a profile its interests leave out', () => {
    const uefa = "Je suis aussi l'arbitrage du football : décisions arbitrales et VAR, polémiques, nominations et sanctions des arbitres, changements des règles du jeu.";

    it('should find the precisions the AI dropped, and not the words that say how the profile is written', () => {
        expect(missingWords(uefa, [{text: 'Arbitrage football : VAR, décisions arbitrales, polémiques, règles du jeu'}]))
            .toEqual(['nominations', 'sanctions', 'changements']);
    });

    it('should count a word named by its start, and the words of what the reader refuses', () => {
        expect(missingWords('Le tennis, les arbitres, mais pas les paris sportifs.', [{text: 'Tennis : arbitrage'}], ['paris sportifs'])).toEqual([]);
        expect(missingWords('Le tennis ATP et la VAR.', [{text: 'Tennis'}])).toEqual(['ATP', 'VAR']);
    });
});

describe('interestsOf', () => {
    const profile = {text: "L'arbitrage du football : VAR, nominations des arbitres.", topics: [], language: 'fr', categories: ['sport']};

    beforeEach(() => ollamaJson.mockReset());

    it('should ask once more when a word of the profile is missing, and keep the answer that misses fewer', async () => {
        ollamaJson
            .mockResolvedValueOnce({interests: [{text: 'Arbitrage du football : VAR'}], refused: []})
            .mockResolvedValueOnce({interests: [{text: 'Arbitrage du football : VAR, nominations des arbitres'}], refused: []});

        const interests = await interestsOf(profile);
        expect(interests.map(interest => interest.text)).toEqual(['Arbitrage du football : VAR, nominations des arbitres']);
        const [conversation] = ollamaJson.mock.calls[1];
        expect(conversation.at(-1).content).toContain('nominations');
    });

    it('should keep the first answer when the second is not better, and not ask when nothing misses', async () => {
        ollamaJson
            .mockResolvedValueOnce({interests: [{text: 'Arbitrage du football : VAR'}]})
            .mockRejectedValueOnce(new Error('The AI did not answer in JSON.'));
        expect((await interestsOf(profile))[0].text).toBe('Arbitrage du football : VAR');

        ollamaJson.mockReset().mockResolvedValueOnce({interests: [{text: 'Arbitrage du football : VAR, nominations des arbitres'}]});
        await interestsOf(profile);
        expect(ollamaJson).toHaveBeenCalledTimes(1);
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

describe('the share of each interest in a briefing', () => {
    // the AI answers 15 stories: 9 on AI (interest 2) first, then 3 on tennis (1) and 3 on politics (3)
    const interestOf = (id) => Number(id[0]);
    const chosen = [...Array.from({length: 9}, (_, i) => `2${i}`), '10', '11', '12', '30', '31', '32'].map(id => ({id, why: ''}));
    const three = [{id: 1, weight: 1}, {id: 2, weight: 1}, {id: 3, weight: 1}];

    it('should give each interest its share of the ten places, then the place left to the next of the AI, in its order', () => {
        const kept = balanceSelection(chosen, interestOf, three).map(item => item.id);
        expect(kept).toEqual(['20', '21', '22', '23', '10', '11', '12', '30', '31', '32']);
    });

    it('should leave the places of an interest without story to the others, and follow the weights', () => {
        const onlyAi = chosen.filter(item => item.id[0] === '2');
        expect(balanceSelection(onlyAi, interestOf, three)).toHaveLength(9);
        const secondary = [{id: 1, weight: 0.85}, {id: 2, weight: 1}];
        const many = ['10', '11', '12', '13', '14', '15', '20', '21', '22', '23', '24', '25'].map(id => ({id, why: ''}));
        const kept = balanceSelection(many, interestOf, secondary).map(item => item.id);
        expect(kept.filter(id => id[0] === '1')).toHaveLength(5);      // floor(10 * 0.85 / 1.85) = 4, then the first left
        expect(kept.filter(id => id[0] === '2')).toHaveLength(5);
    });

    it('should give the AI the interests only when there are several', () => {
        const candidates = [{id: '1', title: 'Arthur Fils dans le Top 10', others: []}];
        expect(selectionPrompt("Le tennis et l'IA.", candidates, undefined, ['Tennis : circuit ATP', 'IA : modèles'])).toContain('Ses intérêts :\n- Tennis : circuit ATP\n- IA : modèles');
        expect(selectionPrompt('Le tennis.', candidates, undefined, ['Tennis : circuit ATP'])).not.toContain('Ses intérêts');
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

describe('confirmOnSubject', () => {
    const interests = ['Le tennis : les tournois ATP et WTA'];

    it('should keep only the numbers of the titles given, counted from 1', async () => {
        ollamaJson.mockResolvedValueOnce({onSubject: [1, '[3]', 3, 9, 0, 'x']});
        expect(await confirmOnSubject(interests, ['Un tournoi', 'Un match de cricket', 'Un classement'])).toEqual(new Set([0, 2]));
    });

    it('should answer null when the AI gives no list, and ask nothing without titles', async () => {
        ollamaJson.mockResolvedValueOnce({titles: 'none'});
        expect(await confirmOnSubject(interests, ['Un tournoi'])).toBeNull();
        ollamaJson.mockClear();
        expect(await confirmOnSubject(interests, [])).toEqual(new Set());
        expect(ollamaJson).not.toHaveBeenCalled();
    });

    it('should give the AI each interest and each title with its number', () => {
        const prompt = confirmPrompt(interests, ['Un tournoi', 'Un classement']);
        expect(prompt).toContain('- Le tennis : les tournois ATP et WTA');
        expect(prompt).toContain('[1] Un tournoi\n[2] Un classement');
        expect(prompt).toContain('Dans le doute, compte-le.');
    });
});
