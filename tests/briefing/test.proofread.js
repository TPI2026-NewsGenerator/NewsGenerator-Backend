//
//  Author: Fabian Rostello
//  Date: 09.11.2026
//  File: test.proofread.js
//  Description: The last read of the cards by the AI (proofread.js): what the AI is shown, what of its answer is kept, what the code checks
//               before taking a piece out, and that a failing AI leaves the cards as they are
//

import process from 'node:process';
import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const ollamaJson = jest.fn();
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson, newUsage: () => ({calls: 0, input: 0, output: 0})}));
const {cutPiece, normalizeFlags, proofread, proofreadCards, proofreadPrompt, viewOf} = await import('../../services/utils/proofread.js');
const {ORIGINAL_START, ORIGINAL_END} = await import('../../services/utils/original-marks.js');

const WORDS = 'The federation named a new referee on Monday for the final after a long meeting of the committee.';
const card = (changes = {}) => ({storyId: 1, title: 'The federation names a new referee for the final', language: 'en',
    summary: `${WORDS}\n\nThe decision was taken by the whole committee on Sunday evening.`,
    points: `${WORDS}\n\nThe decision was taken by the whole committee on Sunday evening.`, digest: WORDS, ...changes});
const quiet = () => ({log: jest.fn(), error: jest.fn()});

beforeEach(() => ollamaJson.mockReset());

describe('viewOf', () => {
    it('should show the translation of a card when it has one, the marks and the sign of figures out, the first paragraphs of each way', () => {
        const view = viewOf(card({language: 'de', title: 'Der Verband', titleTranslation: 'The federation', summary: 'Der Verband.', translation: `One.\n\n${ORIGINAL_START}(Zwei.)${ORIGINAL_END}\n\nThree ⚠.\n\nFour.`}));
        expect(view.title).toBe('The federation');
        expect(view.ways[0]).toEqual(['passages', ['One.', '(Zwei.)', 'Three .']]);
        expect(view.ways.map(([field]) => field)).toEqual(['passages', 'points', 'digest']);
    });

    it('should leave out a way the card does not have', () => {
        expect(viewOf(card({points: null, digest: null})).ways.map(([field]) => field)).toEqual(['passages']);
    });
});

describe('proofreadPrompt', () => {
    it('should number the cards, name the language of the reader and show the ways', () => {
        const prompt = proofreadPrompt([viewOf(card()), viewOf(card({title: 'Second title of a card'}))], 'fr');
        expect(prompt).toContain('shown in French');
        expect(prompt).toContain('[1] title: The federation names a new referee for the final');
        expect(prompt).toContain('[2] title: Second title of a card');
        expect(prompt).toContain('    passages 1: The federation named');
        expect(prompt).toContain('    digest 1: ');
    });
});

describe('normalizeFlags', () => {
    it('should keep the problems of a known kind and field with a text, once, for a card of the call', () => {
        const flags = normalizeFlags({cards: [
            {id: 1, problems: [{field: 'title', kind: 'label', text: ' VIDEO: '}, {field: 'Title', kind: 'LABEL', text: 'VIDEO:'}, {field: 'title', kind: 'odd', text: 'x'}, {field: 'nowhere', kind: 'label', text: 'x'}, {field: 'title', kind: 'label', text: ''}, null]},
            // the field as the AI copies it from the label of the paragraph
            {id: '2', problems: [{field: 'points 1', kind: 'dateline', text: 'GENEVA --'}, {field: ' Points 1', kind: 'dateline', text: 'GENEVA --'}]},
            {id: 3, problems: [{field: 'points', kind: 'dateline', text: 'out of the call'}]},
            {id: 1.5, problems: []}, {problems: []}, {id: 2}],
        }, 2);
        expect([...flags]).toEqual([[0, [{field: 'title', kind: 'label', text: 'VIDEO:'}]], [1, [{field: 'points', kind: 'dateline', text: 'GENEVA --'}]]]);
    });

    it('should keep nothing of an answer that is not a list of cards', () => {
        for (const answer of [null, 'yes', {cards: 'no'}, {cards: [{id: 1, problems: 'none'}]}, []]) expect(normalizeFlags(answer, 3).size).toBe(0);
    });
});

describe('cutPiece', () => {
    // the pieces the AI found in the real cards of 9.11.2026 that the rules did not know (bench/proofread.mjs)
    it.each([
        ['a label before the title', 'VIDEO: Messi scores twice in the final against Spain', 'VIDEO:', 'label', 'title', 'Messi scores twice in the final against Spain'],
        ['a label after the title', 'Messi scores twice in the final against Spain (pic)', '(pic)', 'label', 'title', 'Messi scores twice in the final against Spain'],
        ['another label after the title', 'Messi scores twice in the final against Spain (Video)', '(Video)', 'label', 'title', 'Messi scores twice in the final against Spain'],
        ['a newsletter before the title', 'Thursday briefing: Messi scores twice in the final', 'Thursday briefing:', 'label', 'title', 'Messi scores twice in the final'],
        ['a credit after the title, the dash not in the piece', 'Messi scores twice in the final - by Paolo Moramarco', 'by Paolo Moramarco', 'credit', 'title', 'Messi scores twice in the final'],
        ['a credit after the title, the dash in the piece', 'Messi scores twice in the final – writes IAN LADYMAN', '– writes IAN LADYMAN', 'credit', 'title', 'Messi scores twice in the final'],
        ['the medium after the title', 'Messi scores twice in the final | Yalla Shoot', '| Yalla Shoot', 'credit', 'title', 'Messi scores twice in the final'],
        ['the medium after the title, when the AI calls it junk', 'Messi scores twice in the final | Yalla Shoot', '| Yalla Shoot', 'junk', 'title', 'Messi scores twice in the final'],
        ['a dateline with two dashes', 'GENEVA -- The talks between the two federations will continue on Monday.', 'GENEVA --', 'dateline', 'text', 'The talks between the two federations will continue on Monday.'],
        ['a dateline with a dash and a lower case region', 'Conakry – The talks between the two federations will continue on Monday.', 'Conakry –', 'dateline', 'text', 'The talks between the two federations will continue on Monday.'],
        ['a dateline with a country and a full date', 'NAIROBI, Kenya, November 4, 2026 – The talks between the two federations will continue.', 'NAIROBI, Kenya, November 4, 2026 –', 'dateline', 'text', 'The talks between the two federations will continue.'],
        ['an agency between parentheses', 'WASHINGTON (Reuters) - The talks between the two federations will continue on Monday.', 'WASHINGTON (Reuters) -', 'dateline', 'text', 'The talks between the two federations will continue on Monday.'],
        ['a credit before the sentence', 'HIBAPRESS: The talks between the two federations will continue on Monday.', 'HIBAPRESS:', 'credit', 'text', 'The talks between the two federations will continue on Monday.'],
        ['the piece with spaces of its own', 'GENEVA   --   The talks between the two federations will continue on Monday.', 'GENEVA --', 'dateline', 'text', 'The talks between the two federations will continue on Monday.'],
    ])('should take out %s', (_, text, piece, kind, part, wanted) => {
        expect(cutPiece(text, piece, {kind, part})).toBe(wanted);
    });

    // what the AI flags that is the news itself, the safety of the step: the code leaves it
    it.each([
        ['an attribution that opens the sentence', 'As Gazzetta dello Sport reports, the federation will meet on Monday to decide.', 'As Gazzetta dello Sport reports,', 'credit', 'text'],
        ['a clause with no mark', 'AAP understands the federation will meet on Monday to decide the matter.', 'AAP understands', 'credit', 'text'],
        ['a label that tells what the text is', 'OPINION | Why the federation must change its rules before the final', 'OPINION |', 'label', 'title'],
        ['a live page', 'Live: the federation meets to name the referee of the final', 'Live:', 'label', 'title'],
        ['a piece followed by a lower case word', 'Video: the federation names a new referee for the final', 'Video:', 'label', 'title'],
        ['a piece in the middle of the sentence', 'The federation – by decision of its committee – named a new referee.', 'by decision of its committee', 'credit', 'text'],
        ['a piece that is the whole text', 'GENEVA --', 'GENEVA --', 'dateline', 'text'],
        ['a piece of 17 words', 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen: The talks continue on Monday for the final.', 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen:', 'credit', 'text'],
        ['a title left with two words', 'VIDEO: Messi scores', 'VIDEO:', 'label', 'title'],
        ['a piece that is not in the text', 'The federation named a new referee for the final of the cup.', 'GENEVA --', 'dateline', 'text'],
        // the briefings of 9.11.2026: the AI called the competition of a news a label
        ['a competition the AI calls a label', 'Ligue 1: US Monastir denounces the refereeing and demands an investigation', 'Ligue 1:', 'label', 'title'],
        ['a section the AI calls a label', 'Football: the federation names a new referee for the final', 'Football:', 'label', 'title'],
        ['the place and the date of a caption, what is left would pass for a sentence', 'EAST RUTHERFORD, NEW JERSEY - JULY 19: U.S. President Donald Trump and FIFA President Gianni Infantino hold the trophy.', 'EAST RUTHERFORD, NEW JERSEY - JULY 19:', 'dateline', 'text'],
    ])('should leave %s', (_, text, piece, kind, part) => {
        expect(cutPiece(text, piece, {kind, part})).toBeNull();
    });

    it('should take a label that is a format of the page, and leave a date and a dash that opens a line of a timeline (not the first paragraph)', () => {
        expect(cutPiece('Photos: The federation names a new referee for the final', 'Photos:', {kind: 'label', part: 'title'})).toBe('The federation names a new referee for the final');
        const line = 'October 14 – FIFA put forward a proposal for the council that would see each of its member associations paid.';
        expect(cutPiece(line, 'October 14 –', {kind: 'dateline'})).toBe('FIFA put forward a proposal for the council that would see each of its member associations paid.');
        expect(cutPiece(line, 'October 14 –', {kind: 'dateline', first: false})).toBeNull();
        expect(cutPiece(line, 'October 14 –', {kind: 'credit', first: false})).not.toBeNull();
    });
});

describe('proofread', () => {
    it('should take a dateline the AI found in one way out of the others, where the same sentence opens them, and write it on the card', () => {
        const dated = card({summary: `GENEVA -- ${WORDS}\n\nThe decision was taken by the whole committee on Sunday evening.`, points: `GENEVA -- ${WORDS}\n\nThe decision was taken by the whole committee on Sunday evening.`, digest: `GENEVA -- ${WORDS}`});
        const done = proofread(dated, [{field: 'points', kind: 'dateline', text: 'GENEVA --'}], 'en');
        expect(done.item.summary).toBe(`${WORDS}\n\nThe decision was taken by the whole committee on Sunday evening.`);
        expect(done.item.points).toBe(done.item.summary);
        expect(done.item.digest).toBe(WORDS);
        expect(done.item.proofread).toEqual([{kind: 'dateline', text: 'GENEVA --', fields: ['passages', 'points', 'digest']}]);
        expect(dated.summary.startsWith('GENEVA')).toBe(true);
    });

    it('should take a label out of the title the reader sees: the translation of a title when it has one', () => {
        const done = proofread(card({title: 'Der Verband VIDEO', titleTranslation: 'VIDEO: The federation names a new referee'}), [{field: 'title', kind: 'label', text: 'VIDEO:'}], 'en');
        expect(done.item.titleTranslation).toBe('The federation names a new referee');
        expect(done.item.title).toBe('Der Verband VIDEO');
    });

    it('should take the piece out where the AI says it is not, and not take a piece that is not there', () => {
        expect(proofread(card({title: 'The federation names a new referee (pic)'}), [{field: 'points', kind: 'label', text: '(pic)'}], 'en').item.title).toBe('The federation names a new referee');
        const same = card();
        expect(proofread(same, [{field: 'title', kind: 'label', text: '(Video)'}], 'en')).toEqual({item: same, taken: [], left: []});
    });

    it('should only report a caption and a promotion, and a piece the check does not accept', () => {
        const caption = 'A general view of the stadium before the match between the two teams during the cup.';
        const item = card({summary: `${caption}\n\n${WORDS}\n\nRead more: the referee who changed the match.`});
        const done = proofread(item, [{field: 'passages', kind: 'caption', text: caption}, {field: 'passages', kind: 'junk', text: 'Read more: the referee who changed the match.'},
            {field: 'passages', kind: 'credit', text: 'The federation named'}], 'en');
        expect(done.item).toBe(item);
        expect(done.left.map(one => one.kind)).toEqual(['caption', 'junk', 'credit']);
    });

    it('should take out a whole paragraph in another language that the letters say is one, when other paragraphs are left', () => {
        const german = 'Der Verband hat am Montag einen neuen Schiedsrichter für das Finale ernannt, nachdem der Ausschuss lange beraten hatte.';
        const item = card({summary: `${WORDS}\n\n${german}`});
        const done = proofread(item, [{field: 'passages', kind: 'foreign', text: german}], 'en');
        expect(done.item.summary).toBe(WORDS);
        expect(done.taken).toEqual([{kind: 'foreign', text: german, fields: ['passages']}]);
    });

    it('should not take out text the letters do not say is in another language, a title, the only paragraph, or a sentence left in its language on purpose', () => {
        const german = 'Der Verband hat am Montag einen neuen Schiedsrichter für das Finale ernannt, nachdem der Ausschuss lange beraten hatte.';
        const english = 'The decision was taken by the whole committee on Sunday evening after a long meeting.';
        expect(proofread(card({summary: `${WORDS}\n\n${english}`}), [{field: 'passages', kind: 'foreign', text: english}], 'en').left[0].why).toMatch(/letters/);
        expect(proofread(card({title: german}), [{field: 'title', kind: 'foreign', text: german}], 'en').left[0].why).toMatch(/title/);
        expect(proofread(card({summary: german, points: null, digest: null}), [{field: 'passages', kind: 'foreign', text: german}], 'en').left[0].why).toMatch(/only paragraph/);
        const marked = card({summary: `${WORDS}\n\n${ORIGINAL_START}(${german})${ORIGINAL_END}`});
        expect(proofread(marked, [{field: 'passages', kind: 'foreign', text: `(${german})`}], 'en').item).toBe(marked);
    });

    it('should leave the marks of the sentences that stay in their language where they are, and a piece that crosses them', () => {
        const item = card({summary: `GENEVA -- ${WORDS} ${ORIGINAL_START}(Der Verband.)${ORIGINAL_END}`, points: null, digest: null});
        const done = proofread(item, [{field: 'passages', kind: 'dateline', text: 'GENEVA --'}], 'en');
        expect(done.item.summary).toBe(`${WORDS} ${ORIGINAL_START}(Der Verband.)${ORIGINAL_END}`);
    });
});

describe('proofreadCards', () => {
    it('should take out what the AI points at and the code checks, change only those cards, and tell it', async () => {
        const items = [card({storyId: 1}), card({storyId: 2, title: 'VIDEO: The federation names a new referee for the final'}), card({storyId: 3})];
        ollamaJson.mockResolvedValue({cards: [{id: 1, problems: []}, {id: 2, problems: [{field: 'title', kind: 'label', text: 'VIDEO:'}]},
            {id: 3, problems: [{field: 'points', kind: 'junk', text: 'Follow us on social networks'}]}]});
        const log = quiet();
        const done = await proofreadCards(items, 'en', {log, label: 7});
        expect(done).toHaveLength(3);
        expect(done[0]).toBe(items[0]);
        expect(done[1].title).toBe('The federation names a new referee for the final');
        expect(done[1].proofread).toEqual([{kind: 'label', text: 'VIDEO:', fields: ['title']}]);
        expect(done[2]).toBe(items[2]);
        expect(items[1].title.startsWith('VIDEO')).toBe(true);
        expect(ollamaJson).toHaveBeenCalledTimes(1);
        expect(log.log.mock.calls.map(call => call[0]).join('\n')).toMatch(/Briefing 7: proofread: took out "VIDEO:" \(label, title\)/);
        expect(log.log.mock.calls.at(-1)[0]).toMatch(/3 cards read .* 1 pieces taken out, 0 left/);
    });

    it('should read the cards in calls of its own and number them from one in each', async () => {
        const items = [card({storyId: 1}), card({storyId: 2}), card({storyId: 3, title: 'GENEVA: The federation names a new referee for the final'})];
        ollamaJson.mockImplementation(async (prompt) => prompt.includes('GENEVA:') ? {cards: [{id: 1, problems: [{field: 'title', kind: 'dateline', text: 'GENEVA:'}]}]} : {cards: []});
        const done = await proofreadCards(items, 'en', {log: quiet(), atOnce: 2});
        expect(ollamaJson).toHaveBeenCalledTimes(2);
        expect(done[2].title).toBe('The federation names a new referee for the final');
        expect(done[0]).toBe(items[0]);
    });

    it('should leave the cards of a call that fails as they are, after one more try, and take out what the others found', async () => {
        const items = [card({storyId: 1, title: 'VIDEO: The federation of Alpha names a new referee for the final'}), card({storyId: 2, title: 'VIDEO: The federation of Beta names a new referee for the final'})];
        ollamaJson.mockImplementation(async (prompt) => {
            if (prompt.includes('of Alpha')) throw new Error('down');
            return {cards: [{id: 1, problems: [{field: 'title', kind: 'label', text: 'VIDEO:'}]}]};
        });
        const log = quiet();
        const done = await proofreadCards(items, 'en', {log, atOnce: 1});
        // the call of the first card fails twice (given up), the second is answered
        expect(ollamaJson.mock.calls.filter(call => call[0].includes('of Alpha'))).toHaveLength(2);
        expect(done[0]).toBe(items[0]);
        expect(done[1].title).toBe('The federation of Beta names a new referee for the final');
        expect(log.error.mock.calls[0][0]).toMatch(/cards 1 to 1 were not read \(down\)/);
    });

    it('should never fail, and leave the cards as they are, when the AI fails or answers what cannot be read', async () => {
        const items = [card(), card({storyId: 2})];
        ollamaJson.mockRejectedValue(new Error('down'));
        const log = quiet();
        expect(await proofreadCards(items, 'en', {log})).toEqual(items);
        expect(log.error).toHaveBeenCalled();
        ollamaJson.mockReset().mockResolvedValue('nonsense');
        expect(await proofreadCards(items, 'en', {log: quiet()})).toEqual(items);
        expect(await proofreadCards([], 'en', {log: quiet()})).toEqual([]);
    });

    it('should ask nothing when it is switched off', async () => {
        process.env.AI_PROOFREAD = 'off';
        try {
            const items = [card()];
            expect(await proofreadCards(items, 'en', {log: quiet()})).toBe(items);
            expect(ollamaJson).not.toHaveBeenCalled();
        } finally {
            delete process.env.AI_PROOFREAD;
        }
    });

    it('should count the tokens of its calls in the usage it is given', async () => {
        const usage = {calls: 0, input: 0, output: 0};
        ollamaJson.mockImplementation(async (prompt, counted) => {
            counted.calls += 1;
            counted.input += 100;
            return {cards: []};
        });
        await proofreadCards([card()], 'en', {usage, log: quiet()});
        expect(usage).toEqual({calls: 1, input: 100, output: 0});
    });
});
