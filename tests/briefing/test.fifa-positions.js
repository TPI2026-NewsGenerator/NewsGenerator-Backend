//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: test.fifa-positions.js
//  Description: Tests for the position the map shows from the signals of an association (fifa-positions.js): only an established signal
//               makes a colour, an uncertain one is only counted; a flip needs a declared signal or two; one probable signal against
//               a declared position makes the indications conflicting; a position is stale after 90 days
//

import {describe, expect, it} from '@jest/globals';
import {positionOf} from '../../services/utils/fifa-positions.js';

const signal = (date, stance, level, certainty = 'established') => ({date, stance, level, certainty});
const NOW = new Date('2026-11-12');

describe('positionOf', () => {
    it('should be unknown with no signal, and with only uncertain ones, which it counts', () => {
        expect(positionOf([], NOW)).toMatchObject({position: 'inconnue', uncertain: 0, signals: 0});
        const only = positionOf([signal('2026-11-01', 'for', 'probable', 'uncertain'), signal('2026-11-02', 'against', 'declared', 'uncertain')], NOW);
        expect(only).toMatchObject({position: 'inconnue', uncertain: 2, signals: 0, changed: false});
    });

    it('should take the position of an established signal, declared or probable', () => {
        expect(positionOf([signal('2026-11-01', 'for', 'declared')], NOW)).toMatchObject({position: 'soutien_declare', since: '2026-11-01', changed: false});
        expect(positionOf([signal('2026-11-01', 'against', 'probable')], NOW)).toMatchObject({position: 'non_soutien_probable'});
    });

    it('should not let an uncertain signal change an established position', () => {
        const result = positionOf([signal('2026-10-01', 'for', 'declared'), signal('2026-11-05', 'against', 'declared', 'uncertain')], NOW);
        expect(result).toMatchObject({position: 'soutien_declare', changed: false, uncertain: 1});
    });

    it('should turn the other side on a declared signal, and remember the previous position (the AFC of the gold set: against, then for)', () => {
        const result = positionOf([signal('2026-09-10', 'against', 'declared'), signal('2026-11-05', 'for', 'declared')], NOW);
        expect(result).toMatchObject({position: 'soutien_declare', previous: 'non_soutien_declare', changed: true, since: '2026-11-05'});
    });

    it('should not turn on one probable signal against a declared position, only make the indications conflicting', () => {
        const result = positionOf([signal('2026-10-01', 'for', 'declared'), signal('2026-11-05', 'against', 'probable')], NOW);
        expect(result).toMatchObject({position: 'soutien_declare', changed: false, conflicting: true});
    });

    it('should turn on the second signal of the other side, even probable ones', () => {
        const result = positionOf([signal('2026-10-01', 'for', 'declared'), signal('2026-10-20', 'against', 'probable'), signal('2026-11-05', 'against', 'probable')], NOW);
        expect(result).toMatchObject({position: 'non_soutien_probable', previous: 'soutien_declare', changed: true, conflicting: false});
    });

    it('should drop a pending flip when the first side speaks again, and firm a probable position up with a declared signal', () => {
        const result = positionOf([signal('2026-10-01', 'for', 'probable'), signal('2026-10-10', 'against', 'probable'), signal('2026-10-20', 'for', 'declared')], NOW);
        expect(result).toMatchObject({position: 'soutien_declare', changed: false, conflicting: false});
    });

    it('should be stale after 90 days, and keep the position', () => {
        expect(positionOf([signal('2026-06-01', 'for', 'declared')], NOW)).toMatchObject({position: 'soutien_declare', stale: true});
        expect(positionOf([signal('2026-10-01', 'for', 'declared')], NOW).stale).toBe(false);
    });

    it('should not depend on the order the signals come in', () => {
        const signals = [signal('2026-11-05', 'for', 'declared'), signal('2026-09-10', 'against', 'declared')];
        expect(positionOf(signals, NOW)).toEqual(positionOf([...signals].reverse(), NOW));
    });
});
