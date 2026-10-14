import {cleanTitle, isCut, wholeTitle} from '../../services/utils/titles.js';

describe('cleanTitle', () => {
    it('should take out the name of the medium its feed adds at the end', () => {
        expect(cleanTitle('Timber copie Bergkamp à Arsenal ; Manchester United essuie un nouveau revers | Goal.com Français', 'goal.com'))
            .toBe('Timber copie Bergkamp à Arsenal ; Manchester United essuie un nouveau revers');
        expect(cleanTitle('Nuevas carreras, más becas y cupos: así amplía la UNA sus oportunidades | CR Hoy', 'crhoy.com'))
            .toBe('Nuevas carreras, más becas y cupos: así amplía la UNA sus oportunidades');
        expect(cleanTitle('ЛШ: Викинг го запре Баерн, Барса убедлива во Истанбул - sportsport.mk', 'sportsport.mk'))
            .toBe('ЛШ: Викинг го запре Баерн, Барса убедлива во Истанбул');
    });

    it('should take out a date at the end', () => {
        expect(cleanTitle('Compositions probables : Benfica VS Celtic | 15/10/2026', 'footix.fr')).toBe('Compositions probables : Benfica VS Celtic');
        expect(cleanTitle('KuPS vs Trabzonspor Prediction and Betting Tips | 15th October 2026', 'sportskeeda.com')).toBe('KuPS vs Trabzonspor Prediction and Betting Tips');
        expect(cleanTitle('Hajduk Split vs. Ajax prediction, preview & betting tips – 15/10/2026', 'footballwhispers.com'))
            .toBe('Hajduk Split vs. Ajax prediction, preview & betting tips');
    });

    it('should keep an end that is part of the title, a section, an author or another source', () => {
        for (const [title, medium] of [
            ['Azerbaijan’s oil output falls in September – Trend’s calculations', 'trend.az'],
            ['Arsenal 2-0 Spurs: player ratings - Sky Sports pundits have their say!', 'skysports.com'],
            ['La economía peruana crece 3% en agosto | El Comercio', 'apnoticias.pe'],
            ['The week in politics | Opinion', 'kansascity.com'],
            ['Paris - Saint-Germain', 'psg.fr'],
        ]) {
            expect(cleanTitle(title, medium)).toBe(title);
        }
        // what is left would be no title
        expect(cleanTitle('Live | Goal.com', 'goal.com')).toBe('Live | Goal.com');
        expect(cleanTitle(null, 'goal.com')).toBe('');
    });
});

describe('wholeTitle', () => {
    it('should take the title of the page read when the feed cut it and the page starts the same', () => {
        const cut = 'Notable absence of Spanish referees in Europe raises…';
        expect(isCut(cut)).toBe(true);
        expect(wholeTitle(cut, 'Notable absence of Spanish referees in Europe raises questions | YSscores', 'ysscores.com'))
            .toBe('Notable absence of Spanish referees in Europe raises questions');
        // another page, or none read: the title as it is
        expect(wholeTitle(cut, 'Real Madrid news', 'ysscores.com')).toBe(cut);
        expect(wholeTitle(cut, undefined, 'ysscores.com')).toBe(cut);
        expect(wholeTitle('A whole title', 'A whole title and more', 'ysscores.com')).toBe('A whole title');
    });
});
