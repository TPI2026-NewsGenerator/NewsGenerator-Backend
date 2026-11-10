//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: test.foreign-versions.js
//  Description: The stories of other languages that join a card (foreign-versions.js): only the ones the question of the same fact agrees with, none
//               when the AI fails
//

import process from 'node:process';
import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';

const mergeStories = jest.fn();
jest.unstable_mockModule('../../services/utils/profile-ai.js', () => ({mergeStories}));
const {agreedVersions} = await import('../../services/utils/foreign-versions.js');

const quiet = () => ({log: jest.fn(), error: jest.fn()});
const briefOf = (story) => ({title: `Title of ${story.storyId}`, description: ''});
const version = (storyId) => ({storyId, best: {title: `Version ${storyId}`}, members: []});
// the card of the comment of the head of the referees on the goal (Lardot), its versions the news of the outburst of the coach (Leko) and the
// anger of Bruges (briefing 657 of Roberto, 10.11.2026), the card of another news with a version that is the same news
const lardot = {storyId: 2469527};
const other = {storyId: 500};
const foreign = new Map([[2469527, [version(2454827), version(2427405)]], [500, [version(501)]]]);
const foreignOf = (card) => foreign.get(card.storyId) ?? [];

beforeEach(() => mergeStories.mockReset());
afterEach(() => { delete process.env.AI_STRICT_VERSIONS; });

describe('agreedVersions', () => {
    it('should join a version only when the question of the same fact says it is the fact of its card', async () => {
        mergeStories.mockResolvedValue(new Map([['501', '500']]));
        const log = quiet();
        const agreed = await agreedVersions([lardot, other], foreignOf, briefOf, null, log);
        expect(agreed.get(2469527)).toEqual([]);
        expect(agreed.get(500).map(one => one.storyId)).toEqual([501]);
        expect(log.log.mock.calls.at(-1)[0]).toContain('3 versions in other languages kept by the check, 1 agreed');
    });

    it('should list the cards first, then their versions, each once, with their brief', async () => {
        mergeStories.mockResolvedValue(new Map());
        const shared = new Map([[1, [version(9), version(8)]], [2, [version(9)]]]);
        await agreedVersions([{storyId: 1}, {storyId: 2}], (card) => shared.get(card.storyId) ?? [], briefOf, {calls: 0});
        const [list, usage] = mergeStories.mock.calls[0];
        expect(list.map(story => story.id)).toEqual(['1', '2', '9', '8']);
        expect(list[0]).toEqual({id: '1', lead: {title: 'Title of 1', description: ''}});
        expect(usage).toEqual({calls: 0});
    });

    it('should join a version that the AI links to another version that is the fact of the card (the answer leads to the first story)', async () => {
        // normalizeMerges gives the first story of a chain: both versions lead to the card
        mergeStories.mockResolvedValue(new Map([['2454827', '2469527'], ['2427405', '2469527']]));
        const agreed = await agreedVersions([lardot], foreignOf, briefOf, null, quiet());
        expect(agreed.get(2469527).map(one => one.storyId)).toEqual([2454827, 2427405]);
    });

    it('should not join a version the AI says is the fact of another card', async () => {
        mergeStories.mockResolvedValue(new Map([['2454827', '500']]));
        const agreed = await agreedVersions([lardot, other], foreignOf, briefOf, null, quiet());
        expect(agreed.get(2469527)).toEqual([]);
        expect(agreed.get(500)).toEqual([]);
    });

    it('should join none when the AI fails, and say so', async () => {
        mergeStories.mockRejectedValue(new Error('Ollama: no answer'));
        const log = quiet();
        const agreed = await agreedVersions([lardot, other], foreignOf, briefOf, null, log);
        expect(agreed.get(2469527)).toEqual([]);
        expect(agreed.get(500)).toEqual([]);
        expect(log.error.mock.calls[0][0]).toContain('none joined');
    });

    it('should ask nothing when no card has a version kept', async () => {
        const agreed = await agreedVersions([lardot, other], () => [], briefOf, null, quiet());
        expect(mergeStories).not.toHaveBeenCalled();
        expect(agreed.get(2469527)).toEqual([]);
    });

    it('should keep all the versions the check kept, without asking, when the switch is off', async () => {
        process.env.AI_STRICT_VERSIONS = 'off';
        const agreed = await agreedVersions([lardot, other], foreignOf, briefOf, null, quiet());
        expect(mergeStories).not.toHaveBeenCalled();
        expect(agreed.get(2469527)).toHaveLength(2);
        expect(agreed.get(500)).toHaveLength(1);
    });
});
