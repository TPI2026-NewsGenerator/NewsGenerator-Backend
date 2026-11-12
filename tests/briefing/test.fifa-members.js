//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: test.fifa-members.js
//  Description: Tests for the list of the 211 member associations of FIFA and its 6 confederations (services/utils/fifa-members.json,
//               made by scripts/build-fifa-members.js): the count FIFA gives, one federation of the table of
//               football-associations.js for each member, one confederation, a place to draw it. No network, no database
//

import {describe, expect, it} from '@jest/globals';
import {readFileSync} from 'node:fs';
import {associationsOfCountry} from '../../services/utils/football-associations.js';

const FILE = JSON.parse(readFileSync(new URL('../../services/utils/fifa-members.json', import.meta.url), 'utf8'));
const TABLE = JSON.parse(readFileSync(new URL('../../services/utils/football-associations.json', import.meta.url), 'utf8'));
const members = FILE.members;
const by = (code) => members.find(member => member.fifa === code);

describe('the member associations of FIFA', () => {
    it('should be the 211 FIFA counts, one row each, with a code of FIFA and an item of Wikidata of their own', () => {
        expect(members).toHaveLength(211);
        expect(new Set(members.map(member => member.fifa)).size).toBe(211);
        expect(new Set(members.map(member => member.qid)).size).toBe(211);
        expect(members.every(member => /^[A-Z]{3}$/.test(member.fifa) && /^Q\d+$/.test(member.qid))).toBe(true);
    });

    it('should be spread over the confederations as FIFA spreads them', () => {
        const counts = Object.fromEntries(Object.entries(Object.groupBy(members, member => member.confederation)).map(([code, items]) => [code, items.length]));
        expect(counts).toEqual({AFC: 46, CAF: 54, CONCACAF: 35, CONMEBOL: 10, OFC: 11, UEFA: 55});
        expect(FILE.confederations.map(item => item.fifa).sort()).toEqual(['AFC', 'CAF', 'CONCACAF', 'CONMEBOL', 'OFC', 'UEFA']);
    });

    it('should each be a federation of the table the news are linked with, with the code of its country', () => {
        for (const member of members) {
            const row = TABLE.find(item => item.qid === member.qid);
            expect(row?.level).toBe('association');
            expect(row?.country).toBe(member.iso);
        }
    });

    it('should have the four nations of the United Kingdom apart, each with a code of its own', () => {
        expect(['ENG', 'SCO', 'WAL', 'NIR'].map(code => by(code).iso)).toEqual(['GB-ENG', 'GB-SCT', 'GB-WLS', 'GB-NIR']);
        expect(members.some(member => member.iso === 'GB')).toBe(false);
    });

    it('should have the members the first table missed: Greece (a "sports governing body" in Wikidata), Germany and San Marino (no code of FIFA there)', () => {
        expect(by('GRE')).toMatchObject({association: 'Hellenic Football Federation', iso: 'GR', confederation: 'UEFA'});
        expect(associationsOfCountry('GR')).toHaveLength(1);
        expect(by('GER')).toMatchObject({iso: 'DE', confederation: 'UEFA'});
        expect(by('SMR')).toMatchObject({iso: 'SM', confederation: 'UEFA'});
    });

    it('should not hold the bodies of CONCACAF and the AFC that FIFA does not count', () => {
        const iso = new Set(members.map(member => member.iso));
        for (const code of ['BQ', 'MF', 'GP', 'MP', 'SX']) expect(iso.has(code)).toBe(false);
    });

    it('should give a confederation, and the territories that FIFA counts their own', () => {
        expect(members.every(member => member.confederation)).toBe(true);
        expect(by('TUN').confederation).toBe('CAF');
        expect(by('TAH')).toMatchObject({iso: 'PF', confederation: 'OFC'});
        expect(by('HKG')).toMatchObject({iso: 'HK', confederation: 'AFC'});
        expect(by('KOS')).toMatchObject({iso: 'XK', confederation: 'UEFA'});
        expect(by('EGY')).toMatchObject({country: 'Egypt', confederation: 'CAF'});
    });

    it('should have a place on the map for each', () => {
        for (const member of members) {
            expect(member.lat).toBeGreaterThanOrEqual(-90);
            expect(member.lat).toBeLessThanOrEqual(90);
            expect(member.lng).toBeGreaterThanOrEqual(-180);
            expect(member.lng).toBeLessThanOrEqual(180);
        }
    });
});
