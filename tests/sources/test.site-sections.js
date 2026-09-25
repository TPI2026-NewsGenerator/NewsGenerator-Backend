//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: test.site-sections.js
//  Description: Tests for the reading of the sections of a site that match a subject
//

import {feedLinks, feedsPageLink, keywordJudge, sectionLinks, subjectStats, subjectWords} from '../../services/utils/site-sections.js'

const links = (hrefs) => '<html><body>' + hrefs.map(([href, text]) => `<a href="${href}">${text ?? 'x'}</a>`).join('') + '</body></html>';

describe('subjectWords', () => {
    it('should keep the words long enough to name a section, and the acronyms', () => {
        expect(subjectWords(['Top 14, "Six Nations", IA, santé chiens'])).toEqual(['nations', 'ia', 'sante', 'chiens']);
    });

    it('should drop the words that name no section', () => {
        expect(subjectWords(['actualités chiens'])).toEqual(['chiens']);
    });
});

describe('sectionLinks', () => {
    const home = 'https://www.lefigaro.fr/';

    it('should find the section named in the address or in the text of the link', () => {
        const html = links([['/sports/rugby/'], ['/gastronomie/', 'Gastronomie'], ['/politique/'], ['/voyages/', 'Chefs et restaurants']]);
        expect(sectionLinks(html, home, ['rugby'])).toEqual(['https://www.lefigaro.fr/sports/rugby/']);
        expect(sectionLinks(html, home, ['chef'])).toEqual(['https://www.lefigaro.fr/voyages/']);
    });

    it('should ignore the articles and the other sites', () => {
        const html = links([
            ['/sports/rugby/toulon-bat-vannes-au-bout-du-suspense-2026'],
            ['https://www.rugbyrama.fr/rugby/'],
            ['https://www.lefigaro.fr/sports/rugby/'],
        ]);
        expect(sectionLinks(html, home, ['rugby'])).toEqual(['https://www.lefigaro.fr/sports/rugby/']);
    });

    it('should find nothing without a subject', () => {
        expect(sectionLinks(links([['/rugby/']]), home, [])).toEqual([]);
    });
});

describe('feedsPageLink and feedLinks', () => {
    it('should find the page listing the feeds of a site, which is not a feed itself', () => {
        const html = links([['/rss.xml', 'RSS'], ['/rss/', 'Flux RSS'], ['/politique/']]);
        expect(feedsPageLink(html, 'https://www.lemonde.fr/')).toBe('https://www.lemonde.fr/rss/');
    });

    it('should keep the feeds of the listing that name the subject', () => {
        const html = links([['/rugby/rss_full.xml', 'Rugby'], ['/politique/rss_full.xml', 'Politique'], ['/animaux/', 'Animaux']]);
        expect(feedLinks(html, 'https://www.lemonde.fr/rss/', ['rugby'])).toEqual(['https://www.lemonde.fr/rugby/rss_full.xml']);
        expect(feedLinks(html, 'https://www.lemonde.fr/rss/')).toHaveLength(2);
    });
});

describe('subjectStats', () => {
    const day = (n) => new Date(Date.UTC(2026, 8, 24 - n)).toUTCString();
    const judge = keywordJudge(['rugby, "Top 14"']);

    it('should count the news on the subject and their flow per day', async () => {
        const items = [
            {title: 'Top 14 - Toulon bat Vannes', pubDate: day(0)},
            {title: 'Le rugby français en deuil', pubDate: day(1)},
            {title: 'La Bourse recule', pubDate: day(2)},
        ];
        const stats = await subjectStats(items, judge);
        expect(stats).toMatchObject({onSubject: 2, judged: 3, onSubjectPerDay: 1});
        expect(stats.sample).toBe('Top 14 - Toulon bat Vannes');
    });

    it('should judge only the newest news of a long feed', async () => {
        const items = Array.from({length: 40}, (_, i) => ({title: i < 10 ? 'Rugby' : 'Autre chose', pubDate: day(40 - i)}));
        const stats = await subjectStats(items, judge);
        expect(stats.judged).toBe(30);
        expect(stats.onSubject).toBe(0);    // the 10 on rugby are the oldest
    });

    it('should measure the flow on the dated news only', async () => {
        // an undated news was read as 1970, and the flow of the feed fell to nothing
        const items = [
            {title: 'Top 14 - Toulon bat Vannes', pubDate: day(0)},
            {title: 'Le rugby français en deuil', pubDate: day(1)},
            {title: 'Rugby : le calendrier', pubDate: null},
        ];
        const stats = await subjectStats(items, judge);
        expect(stats).toMatchObject({onSubject: 3, judged: 3, onSubjectPerDay: 3});
    });

    it('should use the judge it is given', async () => {
        const stats = await subjectStats([{title: 'a'}, {title: 'b'}], async (texts) => texts.map(() => true));
        expect(stats.onSubject).toBe(2);
    });
});
