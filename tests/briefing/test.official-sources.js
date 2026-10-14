//
//  Author: Fabian Rostello
//  Date: 12.10.2026
//  File: test.official-sources.js
//  Description: Tests for the official source of a card: the parties the AI names, the posts worth
//               judging (the party's own article of the card too), and a post kept only when both
//               answers of the AI confirm it, one per party
//

import {describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('ollama', () => ({Ollama: jest.fn(() => ({chat: jest.fn()}))}));
jest.unstable_mockModule('../../models/official-model.js', () => ({OfficialModel: {}}));
jest.unstable_mockModule('../../models/feed-model.js', () => ({FeedModel: {saveResolvedLinks: jest.fn()}}));
jest.unstable_mockModule('../../models/mention-model.js', () => ({MentionModel: {}}));
const {MAX_OFFICIAL, candidatesOf, confirmedOf, normalizeParties, partyName, withSiteLinks, withStatements} = await import('../../services/utils/official-sources.js');

describe('withStatements', () => {
    const post = (party) => ({party, channel: 'site'});
    const said = (party) => ({party, channel: 'reported'});

    it('should put the posts first, then the statements of the parties with none, MAX_OFFICIAL at most', () => {
        expect(withStatements([post('UEFA')], [said('uefa'), said('FIFA')])).toEqual([post('UEFA'), said('FIFA')]);
        expect(withStatements([], [said('A'), said('B'), said('C')])).toHaveLength(MAX_OFFICIAL);
        expect(withStatements([post('A')], [])).toEqual([post('A')]);
    });
});

describe('normalizeParties', () => {
    it('should keep the kind, the names and their other names', () => {
        const answer = {kind: 'claim', parties: [{name: ' CONI ', what: 'Italian Olympic committee', other: ['Italian National Olympic Committee', 'CONI', 'x']}]};
        expect(normalizeParties(answer)).toEqual({kind: 'claim', parties: [
            {name: 'CONI', what: 'Italian Olympic committee', other: ['Italian National Olympic Committee', 'CONI']},
        ]});
    });

    it('should give no party to an analysis, and leave out parties without a name', () => {
        expect(normalizeParties({kind: 'analysis', parties: [{name: 'UEFA'}]}).parties).toEqual([]);
        expect(normalizeParties({kind: 'announced', parties: [{what: 'club'}, {name: 'UEFA'}]}).parties.map(p => p.name)).toEqual(['UEFA']);
        expect(normalizeParties(null)).toEqual({kind: 'none', parties: []});
    });

    it('should keep four parties at most', () => {
        const parties = ['A', 'B', 'C', 'D', 'E'].map(name => ({name}));
        expect(normalizeParties({kind: 'claim', parties}).parties).toHaveLength(4);
    });
});

describe('candidatesOf', () => {
    const uefa = {qid: 'Q35572', label: 'Union of European Football Associations', site: ['https://www.uefa.com']};
    const card = {
        title: 'Aleksander Čeferin to seek a final term as UEFA president',
        first: '2026-10-08T10:00:00.000Z',
    };
    const post = (title, at = '2026-10-08T09:00:00.000Z', url = `https://www.uefa.com/news/${title.length}`) => ({channel: 'site', title, text: '', at, url});

    it('should keep the posts sharing words with the card, the most alike first', () => {
        const posts = {Q35572: [
            post('Champions League draw made'),
            post('Čeferin accepts request to seek final term as UEFA President'),
            post('Čeferin seeks final term'),
        ]};
        expect(candidatesOf(card, [uefa], posts).map(p => p.title)).toEqual([
            'Čeferin accepts request to seek final term as UEFA President', 'Čeferin seeks final term',
        ]);
    });

    it('should leave out the posts of long before the card', () => {
        const posts = {Q35572: [post('Čeferin seeks final term', '2026-09-20T09:00:00.000Z')]};
        expect(candidatesOf(card, [uefa], posts)).toEqual([]);
    });

    it('should judge the article of the card itself when the party published it', () => {
        const own = post('Aleksander Čeferin to seek a final term as UEFA president', card.first, 'https://www.uefa.com/news/ceferin');
        expect(candidatesOf(card, [uefa], {Q35572: [own]}).map(p => p.url)).toEqual(['https://www.uefa.com/news/ceferin']);
    });
});

describe('confirmedOf', () => {
    const candidates = [
        {qid: 'Q1', party: 'UEFA', title: 'First post of UEFA', url: 'a'},
        {qid: 'Q1', party: 'UEFA', title: 'Second post of UEFA', url: 'b'},
        {qid: 'Q2', party: 'FIGC', title: 'Post of FIGC', url: 'c'},
        {qid: 'Q3', party: 'CONI', title: 'Post of CONI', url: 'd'},
    ];
    // the second answer numbers the posts in the reverse order
    const reversed = (n) => candidates.length + 1 - n;

    it('should keep a post only when both answers confirm it', () => {
        const first = {posts: [{n: 1, kind: 'confirms'}, {n: 3, kind: 'confirms'}]};
        const second = {posts: [{n: reversed(1), kind: 'confirms'}, {n: reversed(3), kind: 'related'}]};
        expect(confirmedOf(first, second, candidates).map(p => p.url)).toEqual(['a']);
    });

    it('should keep one post per party, MAX_OFFICIAL at most', () => {
        const all = (order) => ({posts: candidates.map((post, i) => ({n: order(i + 1), kind: 'confirms'}))});
        const kept = confirmedOf(all(n => n), all(reversed), candidates);
        expect(kept.map(p => p.url)).toEqual(['a', 'c'].slice(0, MAX_OFFICIAL));
    });

    it('should keep nothing of a denial, or of an answer of another shape', () => {
        const denies = {posts: candidates.map((post, i) => ({n: i + 1, kind: 'denies'}))};
        expect(confirmedOf(denies, denies, candidates)).toEqual([]);
        expect(confirmedOf(null, {posts: []}, candidates)).toEqual([]);
    });
});

describe('withSiteLinks', () => {
    const GOOGLE = 'https://news.google.com/rss/articles/CBMi0AFB?oc=5';
    const UEFA = 'https://www.uefa.com/news-media/news/ceferin-final-term/';

    it("should give a site's post read through Google News the address of the site, and save it", async () => {
        const items = [{party: 'UEFA', channel: 'site', url: GOOGLE}, {party: 'UEFA', channel: 'site', url: GOOGLE},
            {party: 'FIGC', channel: 'reported', url: 'https://news.google.com/rss/articles/other'}];
        const decode = jest.fn(async () => new Map([[GOOGLE, UEFA]]));
        const save = jest.fn(async () => 1);
        await withSiteLinks(items, decode, save);

        expect(decode).toHaveBeenCalledWith([GOOGLE]);
        expect(items.map(item => item.url)).toEqual([UEFA, UEFA, 'https://news.google.com/rss/articles/other']);
        expect(save).toHaveBeenCalledWith([{link: GOOGLE, resolved: UEFA}]);
    });

    it('should keep the link of Google News when it is not decoded, and ask nothing without one', async () => {
        const items = [{party: 'UEFA', channel: 'site', url: GOOGLE}];
        await withSiteLinks(items, async () => { throw new Error('429'); }, async () => 0);
        expect(items[0].url).toBe(GOOGLE);

        const decode = jest.fn();
        await withSiteLinks([{party: 'UEFA', channel: 'site', url: UEFA}], decode);
        expect(decode).not.toHaveBeenCalled();
    });
});

describe('partyName', () => {
    it("should show an item's acronym, or its English label when the AI named it in another language", () => {
        expect(partyName('Eiropas Futbola federāciju asociācija', 'Union of European Football Associations', ['UEFA'])).toBe('UEFA');
        expect(partyName('Federação Portuguesa de Futebol', 'Portuguese Football Federation')).toBe('Portuguese Football Federation');
        expect(partyName('Arsene Wenger', 'Arsène Wenger')).toBe('Arsène Wenger');
    });

    it("should keep the AI's name when the label only says it longer, or there is no English label", () => {
        expect(partyName('Real Madrid', 'Real Madrid Club de Fútbol')).toBe('Real Madrid');
        expect(partyName('Chelsea', 'Chelsea F.C.')).toBe('Chelsea');
        expect(partyName('Luciano Gonçalves', 'Q118655504')).toBe('Luciano Gonçalves');
        expect(partyName('UEFA', undefined)).toBe('UEFA');
    });
});
