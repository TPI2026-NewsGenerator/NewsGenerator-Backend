//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: test.dates.js
//  Description: Tests for the dates of the RSS feeds
//

import {toDate} from '../../services/utils/dates.js'

describe('toDate', () => {
    it('should read the usual formats', () => {
        expect(toDate('Mon, 21 Sep 2026 15:24:00 +0100').toISOString()).toBe('2026-09-21T14:24:00.000Z');
        expect(toDate('2026-09-22T12:14:00Z').toISOString()).toBe('2026-09-22T12:14:00.000Z');
        expect(toDate('Tue, 22 Sep 2026 19:08:00 GMT').toISOString()).toBe('2026-09-22T19:08:00.000Z');
    });

    it('should read the timezone names JavaScript ignores', () => {
        // Sky Sports gives BST, Australian feeds AEST
        expect(toDate('Tue, 22 Sep 2026 19:08:00 BST').toISOString()).toBe('2026-09-22T18:08:00.000Z');
        expect(toDate('Mon, 21 Sep 2026 10:00:00 AEST').toISOString()).toBe('2026-09-21T00:00:00.000Z');
        expect(toDate('Mon, 21 Sep 2026 10:00:00 CEST').toISOString()).toBe('2026-09-21T08:00:00.000Z');
    });

    it('should return null when there is no readable date', () => {
        expect(toDate(null)).toBeNull();
        expect(toDate('')).toBeNull();
        expect(toDate('yesterday')).toBeNull();
        expect(toDate('Mon, 21 Sep 2026 10:00:00 XYZ')).toBeNull();
    });
});
