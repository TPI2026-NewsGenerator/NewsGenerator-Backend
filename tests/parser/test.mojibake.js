//
//  Author: Fabian Rostello
//  Date: 02.11.2026
//  File: test.mojibake.js
//  Description: Tests for the text a site wrote in UTF-8 twice over, put back as it was
//

import {repairMojibake} from '../../services/utils/mojibake.js'
import {Parser} from '../../services/utils/parser.js'

describe('repairMojibake', () => {
    it('should put back an apostrophe read as ISO-8859-1 (the C1 controls)', () => {
        expect(repairMojibake('GFA and FIFA to review Ghanaâ\u0080\u0099s womenâ\u0080\u0099s football strategy'))
            .toBe('GFA and FIFA to review Ghana’s women’s football strategy');
    });

    it('should put back the same text read as Windows-1252 (the characters it shows)', () => {
        expect(repairMojibake('Ghanaâ€™s â€œbest teamâ€\u009d – déjÃ  vu')).toBe('Ghana’s “best team” – déjà vu');
    });

    it('should put back accents, dashes and a letter after the run it ends with', () => {
        expect(repairMojibake('Fatawu Salifu â\u0080\u0093 grÃ¢ce Ã  Salifu')).toBe('Fatawu Salifu – grâce à Salifu');
        expect(repairMojibake('Ã©¿')).toBe('é¿');
    });

    it('should leave text that was never broken as it is', () => {
        for (const text of ['Ghana’s women’s strategy', 'La gare de Marchienne-au-Pont, déjà vue à Uccle', 'Dragão, Ångström, Żółć', 'Miền Bắc sắp đón không khí lạnh', '']) {
            expect(repairMojibake(text)).toBe(text);
        }
        // a no-break space after a letter that starts three bytes ("é") or is the second of two ("É"), before a guillemet or a mark
        for (const text of ['nécessité » : des milliers', 'POURQUOI CELA S’EST PASSÉ !', 'AVÓ ! NIÑ ?', 'Å ']) {
            expect(repairMojibake(text)).toBe(text);
        }
        expect(repairMojibake(null)).toBe(null);
    });
});

describe('Parser.Xml with a title written in UTF-8 twice over', () => {
    it('should give the title as the site meant it', async () => {
        const [item] = await Parser.Xml(`<rss><channel><item><title>Ghanaâ\u0080\u0099s clash</title>
            <description>Equatorial Guineaâ\u0080\u0099s referee</description><link>https://x/a</link></item></channel></rss>`);
        expect(item.title).toBe('Ghana’s clash');
        expect(item.description).toBe('Equatorial Guinea’s referee');
    });
});
