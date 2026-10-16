//
//  Author: Fabian Rostello
//  Date: 16.10.2026
//  File: test.kept-result.js
//  Description: The counts of the profile page read once, then again in the background: no request waits
//

import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';
import {keptResult} from '../../services/utils/kept-result.js';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('a result kept and read again in the background', () => {
    it('should read a key once, and give it again without reading', async () => {
        const read = jest.fn(async (id) => `counts of ${id}`);
        const kept = keptResult(read, {minutes: 15});

        expect(await kept(7, 'v1', 7)).toBe('counts of 7');
        expect(await kept(7, 'v1', 7)).toBe('counts of 7');
        expect(read).toHaveBeenCalledTimes(1);
    });

    it('should read it again at once when what it depends on changed', async () => {
        let round = 0;
        const read = jest.fn(async () => ++round);
        const kept = keptResult(read, {minutes: 15});

        expect(await kept(7, 'v1')).toBe(1);
        expect(await kept(7, 'v2')).toBe(2);
        expect(await kept(7, 'v2')).toBe(2);
    });

    it('should read every key again in the background, and keep the result before when a read fails', async () => {
        let round = 0;
        const read = jest.fn(async () => {
            round++;
            if (round === 3) throw new Error('database away');
            return round;
        });
        const kept = keptResult(read, {minutes: 15});
        const error = jest.spyOn(console, 'error').mockImplementation(() => {});

        expect(await kept('all', 0)).toBe(1);
        await jest.advanceTimersByTimeAsync(15 * 60e3);
        expect(await kept('all', 0)).toBe(2);
        await jest.advanceTimersByTimeAsync(15 * 60e3);
        expect(await kept('all', 0)).toBe(2);
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });

    it('should read again the next time a first read failed', async () => {
        const read = jest.fn()
            .mockRejectedValueOnce(new Error('database away'))
            .mockResolvedValueOnce('counts');
        const kept = keptResult(read, {minutes: 15});

        await expect(kept(7, 'v1')).rejects.toThrow('database away');
        expect(await kept(7, 'v1')).toBe('counts');
    });

    it('should forget a key no request asked for days', async () => {
        const read = jest.fn(async () => 'counts');
        const kept = keptResult(read, {minutes: 15, forgetDays: 1});

        await kept(7, 'v1');
        await jest.advanceTimersByTimeAsync(25 * 3600e3);
        const reads = read.mock.calls.length;
        await jest.advanceTimersByTimeAsync(60 * 60e3);
        expect(read.mock.calls.length).toBe(reads);
    });
});
