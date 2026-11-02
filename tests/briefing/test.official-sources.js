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
const {MAX_OFFICIAL, candidatesOf, confirmedOf, itemsOfNamed, normalizeParties, partyName, withDenialsNamed, withPartiesNamed, withSiteLinks, withStatements} = await import('../../services/utils/official-sources.js');

describe('withStatements', () => {
    const post = (party) => ({party, channel: 'site'});
    const said = (party) => ({party, channel: 'reported'});

    it('should put the posts first, then the statements of the parties with none, MAX_OFFICIAL at most', () => {
        expect(withStatements([post('UEFA')], [said('uefa'), said('FIFA')])).toEqual([post('UEFA'), said('FIFA')]);
        expect(withStatements([], [said('A'), said('B'), said('C')])).toHaveLength(MAX_OFFICIAL);
        expect(withStatements([post('A')], [])).toEqual([post('A')]);
    });
});

describe('withPartiesNamed', () => {
    const said = (party, url = 'https://x/a') => ({party, channel: 'reported', url});
    // the post of the card is the CAF's, shown as its acronym (see partyName)
    const caf = {name: 'CAF', names: ['CAF', 'Confederation of African Football', 'African Football Confederation']};

    it('should show a statement of the party of a post under the name of that post (the user, 2.11.2026: CAF and Confédération Africaine de Football)', () => {
        const [statement] = withPartiesNamed([said('Confédération Africaine de Football')], [caf]);
        expect(statement.party).toBe('CAF');
        expect(withStatements([{party: 'CAF', channel: 'site'}], [statement])).toEqual([{party: 'CAF', channel: 'site'}]);
    });

    it('should know a party by the acronym of its name, by a name it holds, by the other names the AI gives', () => {
        const fifa = {name: 'FIFA', names: ['FIFA', 'Fédération Internationale de Football Association']};
        expect(withPartiesNamed([said('Fédération internationale de football association'), said('FIFA')], [fifa]).map(s => s.party)).toEqual(['FIFA']);
        expect(withPartiesNamed([said('Confederación Africana de Fútbol')], [{name: 'CAF', names: ['CAF', 'African Football Confederation', 'Confederación Africana de Fútbol']}])[0].party).toBe('CAF');
    });

    it('should keep a statement of a party that is none of the card, and one statement per party', () => {
        const kept = withPartiesNamed([said('Ghana Football Association'), said('GFA'), said('Ghana Football Association', 'https://x/b')], [caf]);
        expect(kept.map(statement => statement.party)).toEqual(['Ghana Football Association', 'GFA']);
    });

    it('should not take a body for another that shares a word with it', () => {
        expect(withPartiesNamed([said('Football Association of Zambia')], [{name: 'Ghana Football Association', names: ['GFA']}])[0].party)
            .toBe('Football Association of Zambia');
    });
});

// Wikidata knows which names are one body (the user, 2.11.2026): it is asked for the name a statement is said by
describe('withPartiesNamed with what Wikidata says of the names', () => {
    const said = (party, url = 'https://x/a') => ({party, channel: 'reported', url});
    const caf = {qid: 'Q168360', name: 'CAF', names: ['CAF', 'Confederation of African Football']};
    const gfa = {qid: 'Q923074', name: 'GFA', names: ['GFA', 'Ghana Football Association']};

    it('should show a statement under the party whose item Wikidata calls by the name it is said by', () => {
        const called = new Map([['confederation africaine de football', ['Q168360']]]);
        expect(withPartiesNamed([said('Confédération Africaine de Football')], [gfa, caf], called)).toEqual([said('CAF')]);
        // "CAF" is the name of seven items: the one of the card is among them
        expect(withPartiesNamed([said('Confederación Africana')], [caf], new Map([['confederacion africana', ['Q9', 'Q168360']]]))[0].party).toBe('CAF');
    });

    it('should trust Wikidata over the look of the names: another item is another party, whatever words they share', () => {
        // the name of the zambian federation holds the words of the ghanaian one, but is another item
        const called = new Map([['football association of zambia', ['Q765566']]]);
        expect(withPartiesNamed([said('Football Association of Zambia')], [{qid: 'Q923074', name: 'Football Association', names: ['Football Association']}], called))
            .toEqual([said('Football Association of Zambia')]);
    });

    it('should make one of two names of a party the card has no item for, when Wikidata gives them the one same item', () => {
        const called = new Map([['african football confederation', ['Q168360']], ['confederation africaine de football', ['Q168360']], ['caf', ['Q9', 'Q168360']]]);
        expect(withPartiesNamed([said('African Football Confederation'), said('Confédération Africaine de Football', 'https://x/b')], [], called))
            .toEqual([said('African Football Confederation')]);
        // a name of several items says no one: "CAF" stays apart
        expect(withPartiesNamed([said('CAF'), said('Confédération Africaine de Football', 'https://x/b')], [], called)).toHaveLength(2);
    });

    it('should fall back on the look of the names when Wikidata knows no item of that name', () => {
        expect(withPartiesNamed([said('Confédération Africaine de Football')], [{name: 'CAF', names: ['CAF']}], new Map([['confederation africaine de football', []]])))
            .toEqual([said('CAF')]);
        expect(withPartiesNamed([said('Confédération Africaine de Football')], [{name: 'CAF', names: ['CAF']}])).toEqual([said('CAF')]);
    });
});

// the denials of a card are named as its statements are (the user, 2.11.2026: Wikidata knows which names are one body)
describe('withDenialsNamed', () => {
    const caf = {qid: 'Q168360', name: 'CAF', names: ['CAF', 'Confederation of African Football']};
    const denial = (by, extra = {}) => ({by, sentence: `${by} denies.`, source: 'bbc.com', url: 'https://bbc.com/a', publishedAt: null, language: 'fr', translation: null, ...extra});

    it('should show a denier under the name the card shows its party by, every other field of the denial kept', () => {
        const called = new Map([['confederation africaine de football', ['Q168360']]]);
        const [named] = withDenialsNamed([denial('Confédération Africaine de Football', {translation: 'CAF denies.'})], [caf], called);
        expect(named).toEqual(denial('CAF', {sentence: 'Confédération Africaine de Football denies.', translation: 'CAF denies.'}));
    });

    it('should make one denier of two names Wikidata gives one item, the first one kept', () => {
        const called = new Map([['fifa', ['Q790']], ['federation internationale de football association', ['Q790']]]);
        expect(withDenialsNamed([denial('FIFA'), denial('Fédération internationale de football association'), denial('UEFA')], [], called).map(one => one.by))
            .toEqual(['FIFA', 'UEFA']);
    });

    it('should keep the denials as they are for a card with no party, and none for none', () => {
        const denials = [denial('Iran'), denial('Tehran')];
        expect(withDenialsNamed(denials, [])).toEqual(denials);
        expect(withDenialsNamed(undefined, [caf])).toEqual([]);
    });
});

describe('itemsOfNamed', () => {
    const said = (party, language = 'fr') => ({party, language});
    const parties = [[{name: 'CAF', names: ['CAF', 'African Football Confederation']}]];

    it('should ask Wikidata, in the language of the article, only for the names the card does not know its parties by', async () => {
        const lookup = jest.fn(async () => ['Q168360']);
        const found = await itemsOfNamed([[said('Confédération Africaine de Football'), said('CAF'), said('African Football Confederation', 'en')]], parties, lookup);
        expect(lookup).toHaveBeenCalledTimes(1);
        expect(lookup).toHaveBeenCalledWith('Confédération Africaine de Football', 'fr');
        expect(found).toEqual(new Map([['confederation africaine de football', ['Q168360']]]));
    });

    it('should keep the answers, and ask a name once', async () => {
        const lookup = jest.fn(async () => ['Q6']);
        await itemsOfNamed([[said('Fédération Foo'), said('Fédération Foo')]], [[]], lookup);
        await itemsOfNamed([[said('Fédération Foo')]], [[]], lookup);
        expect(lookup).toHaveBeenCalledTimes(1);
    });

    it('should stop at the first refusal of Wikidata, the names left for the next briefing', async () => {
        const lookup = jest.fn().mockResolvedValueOnce(['Q1']).mockRejectedValueOnce(new Error('Wikidata asked to wait.'));
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const found = await itemsOfNamed([[said('Nom Un'), said('Nom Deux'), said('Nom Trois')]], [[]], lookup);
        expect(lookup).toHaveBeenCalledTimes(2);
        expect([...found.keys()]).toEqual(['nom un']);
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

    // the names read from Wikidata for the item (aliases in many languages, see readChannels): its acronym only when
    // it is the initials of its label
    it('should show the acronym of the names of the item when it is the initials of its label, and none of its other acronyms', () => {
        const caf = ['CAF', 'Confédération africaine de football', 'African Football Confederation'];
        expect(partyName('Confédération Africaine de Football', 'Confederation of African Football', [], caf)).toBe('CAF');
        // "FGF" is the French acronym of the Guinean federation: an English reader reads its English label
        expect(partyName('Guinean Football Federation', 'Guinean Football Federation', [], ['Fédération guinéenne de football', 'FGF']))
            .toBe('Guinean Football Federation');
        // the acronym the AI gives still counts, whatever the initials
        expect(partyName('Guinean Football Federation', 'Guinean Football Federation', ['GFF'], ['FGF'])).toBe('GFF');
    });

    it("should keep the AI's name when the label only says it longer, or there is no English label", () => {
        expect(partyName('Real Madrid', 'Real Madrid Club de Fútbol')).toBe('Real Madrid');
        expect(partyName('Chelsea', 'Chelsea F.C.')).toBe('Chelsea');
        expect(partyName('Luciano Gonçalves', 'Q118655504')).toBe('Luciano Gonçalves');
        expect(partyName('UEFA', undefined)).toBe('UEFA');
    });
});
