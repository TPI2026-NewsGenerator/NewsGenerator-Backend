//
//  Author: Fabian Rostello
//  Date: 06.11.2026
//  File: test.preferences-rules.js
//  Description: What the display preferences saved on an account can be: only the keys the page has, each with only the values it offers,
//               in a body of 4096 bytes at most
//

import {Buffer} from 'node:buffer';
import {describe, expect, it} from '@jest/globals';
import {checkedPreferences, MAX_PREFERENCES_BYTES, PREFERENCES} from '../../services/utils/preferences.js';

const refused = (body, status = 400) => expect(() => checkedPreferences(body)).toThrow(expect.objectContaining({status}));

describe('checkedPreferences', () => {
    it('should take every preference the page has, with a value it offers, as it is', () => {
        const body = {
            layout: 'matrix',
            mailPresets: {short: ['media', 'contested'], standard: ['picture', 'countries', 'names'], everything: ['analysis', 'angles', 'affair', 'coverage']},
            pagePresets: {short: []},
            show: 'standard',
            format: 'digest',
            size: 20,
            followingNews: 50,
        };
        expect(checkedPreferences(body)).toEqual(body);
        expect(Object.keys(body).sort()).toEqual(Object.keys(PREFERENCES).sort());
    });

    it('should take only some of them: the others are not asked for', () => {
        expect(checkedPreferences({size: 30})).toEqual({size: 30});
    });

    it('should take each value of the enumerations, and no other', () => {
        for (const layout of ['frames', 'matrix']) expect(checkedPreferences({layout})).toEqual({layout});
        for (const show of ['short', 'standard', 'everything']) expect(checkedPreferences({show})).toEqual({show});
        for (const format of ['points', 'digest', 'passages']) expect(checkedPreferences({format})).toEqual({format});
        for (const size of [10, 20, 30]) expect(checkedPreferences({size})).toEqual({size});
        for (const followingNews of [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) expect(checkedPreferences({followingNews})).toEqual({followingNews});
    });

    it('should refuse what is not an object, or an object with nothing to save', () => {
        for (const body of [undefined, null, 'size', 20, true, [], [{size: 20}]]) refused(body);
        refused({});
    });

    it('should refuse a key that is no preference, and say which', () => {
        expect(() => checkedPreferences({size: 20, theme: 'dark'})).toThrow(/theme is not a preference/);
        for (const key of ['theme', 'profile', 'search', 'id', 'password', 'role', '__proto__', 'constructor', 'toString']) {
            refused(JSON.parse(`{"${key}": "x"}`));
        }
    });

    it('should refuse a layout, a preset, a way, a size or a number of news the page does not offer', () => {
        for (const layout of ['carousel', 'Frames', '', null, 1, ['frames'], {}]) refused({layout});
        for (const show of ['huge', 'Short', '', null, 0, ['short']]) refused({show});
        for (const format of ['summary', 'Points', '', null, 3]) refused({format});
        for (const size of [0, 5, 15, 40, -10, 10.5, '20', null, [20], NaN]) refused({size});
        for (const followingNews of [0, 5, 15, 110, 200, -10, 10.5, '50', null, [50], NaN]) refused({followingNews});
    });

    it('should refuse presets that are not the three of the page, each a list of its blocks', () => {
        for (const scope of ['mailPresets', 'pagePresets']) {
            refused({[scope]: {}});
            refused({[scope]: 'short'});
            refused({[scope]: null});
            refused({[scope]: ['short']});
            // a preset there is none of
            refused({[scope]: {long: ['media']}});
            // not a list, a block there is none of, a block twice
            refused({[scope]: {short: 'media'}});
            refused({[scope]: {short: {media: true}}});
            refused({[scope]: {short: ['media', 'sparkles']}});
            refused({[scope]: {short: [1]}});
            refused({[scope]: {short: ['media', 'media']}});
            refused({[scope]: {short: [null]}});
        }
    });

    it('should refuse everything when one of the keys is wrong: nothing is half taken', () => {
        refused({size: 20, layout: 'carousel'});
        refused({size: 20, theme: 'dark'});
    });

    it('should refuse a body over its size, and take one at it', () => {
        // a list of presets cannot be this long, a key cannot be this long: the body is the one checked first
        refused({size: 20, padding: 'x'.repeat(MAX_PREFERENCES_BYTES)}, 413);
        expect(Buffer.byteLength(JSON.stringify({mailPresets: {short: ['media'], standard: ['media'], everything: ['media']}}))).toBeLessThan(MAX_PREFERENCES_BYTES);
    });

    it('should take the biggest body there can be, both presets with every block in each', () => {
        const every = ['picture', 'countries', 'media', 'contested', 'official', 'unconfirmed', 'names', 'analysis', 'angles', 'affair', 'coverage'];
        const lists = {short: every, standard: every, everything: every};
        const body = {layout: 'frames', mailPresets: lists, pagePresets: lists, show: 'everything', format: 'passages', size: 30, followingNews: 100};
        expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(MAX_PREFERENCES_BYTES);
        expect(checkedPreferences(body)).toEqual(body);
    });
});
