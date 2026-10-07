//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: test.vectors.js
//  Description: Tests for the bge-m3 vectors as pgvector reads them, and the language of a news
//

import process from 'node:process'
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
    const realFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = realFetch;
        delete process.env.EMBEDDER_URL;
        delete process.env.EMBEDDER_BATCH;
    });

    const healthy = (device) => ({ok: true, status: 200, json: async () => ({status: 'ok', ...(device ? {device} : {})})});
    const vectorsOf = (texts) => ({ok: true, status: 200, json: async () => ({
        dense: texts.map(text => [text.length]),
        sparse: texts.map(() => ({})),
    })});
    const down = () => Promise.reject(Object.assign(new TypeError('fetch failed'), {cause: {code: 'UND_ERR_CONNECT_TIMEOUT'}}));
    // fetch answering /health with 'health' and /embed with 'answer', both given the host asked
    const fakeFetch = ({health = () => healthy(), answer = (host, texts) => vectorsOf(texts)} = {}) => jest.fn(async (url, options) => {
        const {host, pathname} = new URL(url);
        return pathname === '/health' ? health(host) : answer(host, JSON.parse(options.body).texts);
    });
    // the requests of texts: [[host, number of texts]]
    const sent = () => globalThis.fetch.mock.calls
        .filter(([url]) => url.endsWith('/embed'))
        .map(([url, {body}]) => [new URL(url).host, JSON.parse(body).texts.length]);

    it('should send one request at a time, the others wait here and not at the embedder', async () => {
        let inFlight = 0;
        let most = 0;
        globalThis.fetch = fakeFetch({answer: async (host, texts) => {
            most = Math.max(most, ++inFlight);
            await new Promise(resolve => setTimeout(resolve, 20));
            inFlight--;
            return vectorsOf(texts);
        }});

        const [a, b] = await Promise.all([embed(['one']), embed(['three'])]);
        expect(most).toBe(1);
        expect(sent()).toHaveLength(2);
        expect([...a[0].dense]).toEqual([3]);
        expect([...b[0].dense]).toEqual([5]);
    });

    it('should say why the embedder did not answer, and let the next request go', async () => {
        let calls = 0;
        globalThis.fetch = fakeFetch({answer: (host, texts) => ++calls === 1
            ? Promise.reject(Object.assign(new TypeError('fetch failed'), {cause: {code: 'UND_ERR_HEADERS_TIMEOUT'}}))
            : vectorsOf(texts)});

        await expect(embed(['a'])).rejects.toThrow('fetch failed: UND_ERR_HEADERS_TIMEOUT');
        expect((await embed(['b']))[0].sparse).toEqual({});
    });

    it('should send the token of an embedder on another machine, and say when it is refused', async () => {
        process.env.EMBEDDER_TOKEN = 'a-secret-of-the-embedder';
        try {
            let calls = 0;
            globalThis.fetch = fakeFetch({answer: (host, texts) => ++calls === 1 ? vectorsOf(texts) : {ok: false, status: 401}});

            await embed(['a']);
            const [[, first]] = globalThis.fetch.mock.calls.filter(([url]) => url.endsWith('/embed'));
            expect(first.headers.Authorization).toBe('Bearer a-secret-of-the-embedder');
            await expect(embed(['b'])).rejects.toThrow('EMBEDDER_TOKEN must be the same on both sides');
        } finally {
            delete process.env.EMBEDDER_TOKEN;
        }
    });

    it('should send half of a character as the replacement character, the tokenizer refuses it', async () => {
        globalThis.fetch = fakeFetch();
        // a description cut at 400 units inside an emoji
        await embed(['Rich & Ken with Ted Johnson \uD83C']);
        const [[, first]] = globalThis.fetch.mock.calls.filter(([url]) => url.endsWith('/embed'));
        expect(JSON.parse(first.body).texts).toEqual(['Rich & Ken with Ted Johnson �']);
    });

    it('should send no token to an embedder of this machine', async () => {
        globalThis.fetch = fakeFetch();
        await embed(['a']);
        const [[, first]] = globalThis.fetch.mock.calls.filter(([url]) => url.endsWith('/embed'));
        expect(first.headers.Authorization).toBeUndefined();
    });

    it('should use the first embedder of the list that answers, with small batches on a processor', async () => {
        process.env.EMBEDDER_URL = 'http://gaming-a:8020, http://server-a:8020';
        process.env.EMBEDDER_BATCH = '128';
        globalThis.fetch = fakeFetch({health: (host) => host === 'gaming-a:8020' ? down() : healthy('cpu')});

        const vectors = await embed(Array.from({length: 20}, (_, i) => `text ${i}`));
        expect(vectors).toHaveLength(20);
        expect(sent()).toEqual([['server-a:8020', 16], ['server-a:8020', 4]]);
    });

    it('should hand the rest to the next embedder when the first stops answering', async () => {
        process.env.EMBEDDER_URL = 'http://gaming-b:8020,http://server-b:8020';
        process.env.EMBEDDER_BATCH = '2';
        let switchedOff = false;
        globalThis.fetch = fakeFetch({
            health: (host) => host === 'gaming-b:8020' && switchedOff ? down() : healthy(host === 'server-b:8020' ? 'cpu' : 'cuda'),
            answer: (host, texts) => {
                if (host !== 'gaming-b:8020') return vectorsOf(texts);
                if (sent().length > 1) {
                    switchedOff = true;
                    return down();
                }
                return vectorsOf(texts);
            },
        });

        const vectors = await embed(['a', 'bb', 'ccc', 'dddd', 'eeeee']);
        expect(vectors.map(vector => vector.dense[0])).toEqual([1, 2, 3, 4, 5]);
        expect(sent()).toEqual([['gaming-b:8020', 2], ['gaming-b:8020', 2], ['server-b:8020', 3]]);
    });

    it('should hand the rest to the next embedder when the first keeps failing but still answers its health', async () => {
        process.env.EMBEDDER_URL = 'http://gaming-d:8020,http://server-d:8020';
        globalThis.fetch = fakeFetch({
            health: (host) => healthy(host === 'server-d:8020' ? 'cpu' : 'cuda'),
            answer: (host, texts) => host === 'gaming-d:8020'
                ? Promise.reject(Object.assign(new TypeError('fetch failed'), {cause: {code: 'UND_ERR_SOCKET'}}))
                : vectorsOf(texts),
        });

        const vectors = await embed(['a', 'bb']);
        expect(vectors.map(vector => vector.dense[0])).toEqual([1, 2]);
        // a connection closed is asked again once, then the next one takes the work
        expect(sent()).toEqual([['gaming-d:8020', 2], ['gaming-d:8020', 2], ['server-d:8020', 2]]);
    });

    it('should ask again an embedder that closed the connection once, and keep it', async () => {
        process.env.EMBEDDER_URL = 'http://gaming-e:8020,http://server-e:8020';
        let closed = false;
        globalThis.fetch = fakeFetch({
            answer: (host, texts) => {
                if (!closed) {
                    closed = true;
                    return Promise.reject(Object.assign(new TypeError('fetch failed'), {cause: {code: 'UND_ERR_SOCKET'}}));
                }
                return vectorsOf(texts);
            },
        });

        await embed(['a']);
        expect(sent()).toEqual([['gaming-e:8020', 1], ['gaming-e:8020', 1]]);
    });

    it('should give the work back to the first embedder a minute after it answers again', async () => {
        process.env.EMBEDDER_URL = 'http://gaming-c:8020,http://server-c:8020';
        let gamingOn = false;
        globalThis.fetch = fakeFetch({health: (host) => host === 'gaming-c:8020' && !gamingOn ? down() : healthy()});
        const now = jest.spyOn(Date, 'now');
        try {
            now.mockReturnValue(1000000);
            await embed(['a']);
            gamingOn = true;
            now.mockReturnValue(1030000);
            await embed(['b']);
            now.mockReturnValue(1061000);
            await embed(['c']);
        } finally {
            now.mockRestore();
        }
        expect(sent().map(([host]) => host)).toEqual(['server-c:8020', 'server-c:8020', 'gaming-c:8020']);
    });

    it('should name every embedder when none answers', async () => {
        process.env.EMBEDDER_URL = 'http://gaming-d:8020,http://server-d:8020';
        globalThis.fetch = fakeFetch({health: () => down()});

        await expect(embed(['a'])).rejects.toMatchObject({
            status: 503,
            message: expect.stringContaining('http://gaming-d:8020 nor at http://server-d:8020'),
        });
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

    it('should give a tie of the short words to the language of the feed', () => {
        // three "la": as much French, Spanish and Italian
        const title = 'La FIFA sanciona a la federación noruega tras la queja';
        expect(languageOf(title)).toBe('fr');
        expect(languageOf(title, 'es')).toBe('es');
        expect(languageOf(title, 'it')).toBe('it');
        expect(languageOf('Le président de la FIFA répond à la Norvège', 'es')).toBe('fr');
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
        expect(languageOf('Tydzień temu nie było różnic, bo ciężko było cokolwiek wybrać, więc lecimy już w piątek dla was')).toBe('pl');
        expect(languageOf('Kovářovy minely otevírají dveře konkurenci, ale trenér už ví, že jeho brankář je jako skála')).toBe('cs');
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

    // the news of a Hungarian feed: "a" and "is" are English short words too
    const hungarian = [
        'A Ferencváros nyert a bajnokság rangadóján, és a csapat továbbra is vezeti a tabellát a hétvége után',
        'Az edző szerint a csapat jól játszott, de a második félidőben fáradtak voltak a játékosok',
        'A válogatott keretét kedden hirdeti ki a szövetségi kapitány, több új játékos is bekerülhet',
        'Hosszabbított a klub a csatárával, aki még három évig marad a fővárosi együttesnél',
        'A bajnokság következő fordulójában a listavezető idegenben lép pályára szombat este',
    ];

    it('should tell a language the short words do not know from the news joined, and keep it for its news', () => {
        expect(languageOf(hungarian[0])).toBe('en');        // what the short words alone say
        expect(feedLanguage(hungarian)).toBe('hu');
        expect(languageOf(hungarian[0], 'hu')).toBe('hu');
        expect(languageOf(hungarian.join(' '))).toBe('hu');  // a long text without its feed
    });

    it('should let the country of the site decide between Croatian, Bosnian and Serbian', () => {
        const croatian = [
            'Dinamo je pobijedio Hajduk u derbiju i preuzeo vodstvo na ljestvici nakon desetog kola prvenstva',
            'Trener je nakon utakmice rekao da je momčad igrala odlično i da zaslužuje pobjedu pred navijačima',
            'Reprezentacija se okuplja u ponedjeljak, a izbornik će objaviti popis igrača za kvalifikacije',
            'Klub je produžio ugovor s napadačem koji će ostati još tri godine u Zagrebu',
            'Sljedeće kolo donosi gostovanje vodećeg kluba u Osijeku u subotu navečer',
        ];
        expect(feedLanguage(croatian, 'https://www.index.hr/rss')).toBe('hr');
        expect(feedLanguage(croatian, 'https://sportsport.ba/feed')).toBe('bs');
    });
});
