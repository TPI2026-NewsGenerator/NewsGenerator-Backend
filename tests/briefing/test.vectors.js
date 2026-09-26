//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: test.vectors.js
//  Description: Tests for the bge-m3 vectors as pgvector reads them, and the language of a news
//

import {jest} from '@jest/globals'
import {denseSimilarity, embed, parseVector, SPARSE_DIMENSIONS, toSparsevec, toVector} from '../../services/utils/embedder.js'
import {feedLanguage, languageOf} from '../../services/utils/language.js'

const unit = (...values) => {
    const norm = Math.hypot(...values);
    return Float32Array.from(values.map(value => value / norm));
};

describe('denseSimilarity', () => {
    it('should give the cosine of two normalized vectors', () => {
        expect(denseSimilarity(unit(1, 0), unit(1, 0))).toBeCloseTo(1);
        expect(denseSimilarity(unit(1, 0), unit(0, 1))).toBeCloseTo(0);
        expect(denseSimilarity(unit(1, 1), unit(1, 0))).toBeCloseTo(Math.SQRT1_2);
    });
});

describe('embed', () => {
    const realFetch = global.fetch;
    afterEach(() => { global.fetch = realFetch; });

    it('should send one request at a time, the others wait here and not at the embedder', async () => {
        let inFlight = 0;
        let most = 0;
        global.fetch = jest.fn(async (url, {body}) => {
            const {texts} = JSON.parse(body);
            most = Math.max(most, ++inFlight);
            await new Promise(resolve => setTimeout(resolve, 20));
            inFlight--;
            return {ok: true, status: 200, json: async () => ({
                dense: texts.map(text => [text.length]),
                sparse: texts.map(() => ({})),
            })};
        });

        const [a, b] = await Promise.all([embed(['one']), embed(['three'])]);
        expect(most).toBe(1);
        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect([...a[0].dense]).toEqual([3]);
        expect([...b[0].dense]).toEqual([5]);
    });

    it('should say why the embedder did not answer, and let the next request go', async () => {
        global.fetch = jest.fn()
            .mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'), {cause: {code: 'UND_ERR_HEADERS_TIMEOUT'}}))
            .mockResolvedValueOnce({ok: true, status: 200, json: async () => ({dense: [[1]], sparse: [{}]})});

        await expect(embed(['a'])).rejects.toThrow('fetch failed: UND_ERR_HEADERS_TIMEOUT');
        expect((await embed(['b']))[0].sparse).toEqual({});
    });

    it('should send the token of an embedder on another machine, and say when it is refused', async () => {
        process.env.EMBEDDER_TOKEN = 'a-secret-of-the-embedder';
        try {
            global.fetch = jest.fn()
                .mockResolvedValueOnce({ok: true, status: 200, json: async () => ({dense: [[1]], sparse: [{}]})})
                .mockResolvedValueOnce({ok: false, status: 401});

            await embed(['a']);
            expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer a-secret-of-the-embedder');
            await expect(embed(['b'])).rejects.toThrow('EMBEDDER_TOKEN must be the same on both sides');
        } finally {
            delete process.env.EMBEDDER_TOKEN;
        }
    });

    it('should send no token to an embedder of this machine', async () => {
        global.fetch = jest.fn().mockResolvedValueOnce({ok: true, status: 200, json: async () => ({dense: [[1]], sparse: [{}]})});
        await embed(['a']);
        expect(global.fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
    });
});

describe('vectors for pgvector', () => {
    it('should write a dense vector as pgvector reads it, and read it back', () => {
        const vector = Float32Array.from([0.5, -0.25, 0.125]);
        expect(toVector(vector)).toBe('[0.5,-0.25,0.125]');
        expect([...parseVector(toVector(vector))]).toEqual([...vector]);
    });

    it('should write the weights of the words from index 1, in order', () => {
        // the token ids of bge-m3 start at 0, the indices of a sparsevec at 1
        expect(toSparsevec({'250001': 0.1, '5': 0.3, '0': 0.2})).toBe(`{1:0.2,6:0.3,250002:0.1}/${SPARSE_DIMENSIONS}`);
    });

    it('should drop what pgvector would refuse', () => {
        expect(toSparsevec({'250002': 0.5, 'x': 0.5, '-1': 0.5, '7': 0})).toBe(`{}/${SPARSE_DIMENSIONS}`);
        expect(toSparsevec(null)).toBe(`{}/${SPARSE_DIMENSIONS}`);
    });
});

describe('languageOf', () => {
    it('should read the language of a news from its common words', () => {
        expect(languageOf("Le Stade toulousain s'impose face à La Rochelle dans le choc de la journée")).toBe('fr');
        expect(languageOf('The coach of the Crew was fired after his comments to the referee')).toBe('en');
        expect(languageOf('El Real Madrid gana el derbi con un gol en el último minuto')).toBe('es');
        expect(languageOf('Die Regierung hat sich auf einen neuen Haushalt für das nächste Jahr geeinigt')).toBe('de');
    });

    it('should keep the language of the feed when the text is too short to tell', () => {
        expect(languageOf('Top 14 : Toulon', 'fr')).toBe('fr');
        expect(languageOf('', null)).toBeNull();
    });
});

describe('feedLanguage', () => {
    it('should tell a Dutch feed from the languages of the readers', () => {
        // favorflav.com/nl/restaurant/feed/, found by a French search on gastronomy
        expect(feedLanguage([
            'Zonder reservering tóch een tafeltje bij een topzaak bemachtigen',
            'Een ode aan de visstick',
            'Nieuw: De Japanner in Amsterdam-Zuid',
            'Ga eens naar een sterrenrestaurant',
            'Fantastisch nieuws: de beste pizzeria van het land gaat nu ook bezorgen',
        ])).toBe('nl');
        expect(languageOf('Van Dijk remains the leader of the defence')).toBe('en');
        expect(languageOf('Robertson no olvida a Diogo Jota: no nos importaba el fútbol, era la vida de la familia')).toBe('es');
    });

    it('should say nothing when too few news tell it or they do not agree', () => {
        expect(feedLanguage(['Top 14', 'PSG 2-1 OM', 'Ligue 1 : Lens-Nice', 'Le choc de la journée pour le club'])).toBeNull();
        expect(feedLanguage([
            'The coach of the Crew was fired', 'Le Stade toulousain gagne le choc de la journée',
            'El Real Madrid gana el derbi con un gol', 'Die Regierung hat sich auf einen Haushalt geeinigt',
        ])).toBeNull();
        expect(feedLanguage([])).toBeNull();
    });
});
