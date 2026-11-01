//
//  Author: Fabian Rostello
//  Date: 02.11.2026
//  File: test.memo.js
//  Description: A small memory of answers, kept for a time, the oldest forgotten past a number
//

import {afterEach, describe, expect, it, jest} from '@jest/globals';
import {memo} from '../../services/utils/memo.js';

describe('memo', () => {
    afterEach(() => jest.restoreAllMocks());

    it('should give back what was kept, and nothing for what was not', () => {
        const kept = memo({ttlMs: 1000, max: 10});
        kept.set('a', {found: 1});
        expect(kept.get('a')).toEqual({found: 1});
        expect(kept.get('b')).toBeUndefined();
        // an answer that is empty is an answer
        kept.set('c', null);
        expect(kept.get('c')).toBeNull();
    });

    it('should forget an answer after the time, and the oldest past the number', () => {
        let now = 1000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
        const kept = memo({ttlMs: 500, max: 2});
        kept.set('a', 1);
        now += 400;
        kept.set('b', 2);
        expect(kept.get('a')).toBe(1);
        now += 200;
        expect(kept.get('a')).toBeUndefined();
        expect(kept.get('b')).toBe(2);

        kept.set('c', 3);
        kept.set('d', 4);
        expect(kept.size()).toBe(2);
        expect(kept.get('b')).toBeUndefined();
        expect(kept.get('d')).toBe(4);
        kept.clear();
        expect(kept.size()).toBe(0);
    });
});
