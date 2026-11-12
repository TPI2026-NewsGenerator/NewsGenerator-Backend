//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: test.fifa-site.js
//  Description: Tests for the president of an association as the public page of FIFA gives it (fifa-site.js): the name from the JSON of the page, the officers
//               with their roles, the capitals of the surname brought down, a page with no president or that is not a page of an association left out
//

import {describe, expect, it} from '@jest/globals';
import {leaderOfPage, niceName, pageUrl} from '../../services/utils/fifa-site.js';

const page = (data) => `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
const data = (pageData) => ({props: {pageProps: {association: {pageData}}}});
const members = [
    {name: 'Cindy Parlow CONE', roles: ['President', 'FIFA Council - Member']},
    {name: 'J.T. BATSON', roles: ['General Secretary']},
];

describe('niceName', () => {
    it('should bring the capitals of a surname down, and keep what is not in capitals', () => {
        expect(niceName('Said ATHOUMAN')).toBe('Said Athouman');
        expect(niceName('Cindy Parlow CONE')).toBe('Cindy Parlow Cone');
        expect(niceName('Philippe DIALLO')).toBe('Philippe Diallo');
        expect(niceName('Jesper Møller')).toBe('Jesper Møller');
    });

    it('should keep the parts of a hyphenated or apostrophe name, the small words of an Arab or Dutch name, and the initials', () => {
        expect(niceName('Salman BIN IBRAHIM AL-KHALIFA')).toBe('Salman bin Ibrahim Al-Khalifa');
        expect(niceName("Mike O'NEILL")).toBe("Mike O'Neill");
        expect(niceName('J.T. BATSON')).toBe('J.T. Batson');
        // a particle only between the first and the last word
        expect(niceName('Jan DEN BOER')).toBe('Jan den Boer');
        expect(niceName('Person DEN')).toBe('Person Den');
        expect(niceName('AL NAHYAN')).toBe('Al Nahyan');
    });
});

describe('leaderOfPage', () => {
    it('should read the president of the hero of the page, and the officers with their roles', () => {
        const found = leaderOfPage(page(data({hero: {association: {president: {label: 'President', value: 'Cindy Parlow CONE'}}}, organizationIntroSectionProps: {organization: {members}}})));
        expect(found.name).toBe('Cindy Parlow Cone');
        expect(found.officers).toEqual([{name: 'Cindy Parlow Cone', roles: ['President', 'FIFA Council - Member']}, {name: 'J.T. Batson', roles: ['General Secretary']}]);
    });

    it('should read the president among the officers when the hero does not name him', () => {
        expect(leaderOfPage(page(data({organizationIntroSectionProps: {organization: {members}}}))).name).toBe('Cindy Parlow Cone');
    });

    it('should give nothing for a page with no president, no JSON, a broken one, or an officer who is only the general secretary', () => {
        expect(leaderOfPage(page(data({organizationIntroSectionProps: {organization: {members: [members[1]]}}})))).toBeNull();
        expect(leaderOfPage('<html>no data</html>')).toBeNull();
        expect(leaderOfPage('<script id="__NEXT_DATA__" type="application/json">{broken</script>')).toBeNull();
        expect(leaderOfPage(null)).toBeNull();
        expect(leaderOfPage(page({props: {}}))).toBeNull();
    });
});

describe('pageUrl', () => {
    it('should be the public page of the organisation of an association by its code of FIFA', () => {
        expect(pageUrl('KSA')).toBe('https://inside.fifa.com/en/associations/KSA/organisation');
    });
});
