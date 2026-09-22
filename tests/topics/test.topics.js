//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: test.topics.js
//  Description: Tests for topics validation
//

import {topicsError} from '../../services/utils/topics.js'

describe('topicsError', () => {
    it('should accept no topics', () => {
        expect(topicsError(undefined, undefined)).toBeNull();
        expect(topicsError([], [])).toBeNull();
    });

    it('should accept known desired and undesired topics', () => {
        expect(topicsError(['politics', 'economy'], ['sport'])).toBeNull();
    });

    it('should refuse an unknown topic', () => {
        expect(topicsError(['gossip'], [])).toMatch(/^Topics must be an array of/);
        expect(topicsError([], ['gossip'])).toMatch(/^Undesired topics must be an array of/);
    });

    it('should refuse topics that are not an array', () => {
        expect(topicsError('politics', undefined)).toMatch(/^Topics must be an array of/);
    });

    it('should refuse a topic both desired and undesired', () => {
        expect(topicsError(['politics', 'economy'], ['economy'])).toBe("A topic can't be desired and undesired: economy.");
    });
});
