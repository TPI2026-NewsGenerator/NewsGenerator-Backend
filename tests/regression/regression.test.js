//
//  Author: Fabian Rostello
//  Date: 06.11.2026
//  File: regression.test.js
//  Description: The corpus of regression of the briefing, offline: every case of tests/regression/corpus.json run through the logic that
//               has no AI (the language of a title, the check of the figures of a translation, the dateline, the spelling of the names,
//               the small letter after "If", the names a person is followed by, the checks of a neutral title, the countries of the places
//               a name declines or several items share, the pieces the proofreading of the cards takes out or leaves). A test a case, named by
//               it. A problem reported on a card adds its case to the corpus first, then the logic is fixed (see README.md)
//

import {readFileSync} from 'node:fs';
import {describe, expect, it, jest} from '@jest/globals';

// nothing is asked of the AI here, but the modules that ask it are loaded
jest.unstable_mockModule('ollama', () => ({Ollama: jest.fn(() => ({chat: jest.fn()}))}));
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));

const {languageOf, ownLanguage, titleLanguage} = await import('../../services/utils/language.js');
const {keepsFigures, splitSentences} = await import('../../services/utils/extract.js');
const {alignNames} = await import('../../services/utils/spellings.js');
const {withCleanNext} = await import('../../services/utils/card-analysis.js');
const {searchNamesFor} = await import('../../services/utils/watch-names.js');
const {cardNames, tidyNames, withoutConcepts, withoutUnreadable, withSameItemJoined, withSurnamesLinked} = await import('../../services/utils/card-names.js');
const {nationalityOf} = await import('../../services/utils/nationalities.js');
const {countryDeclined, countryNamed} = await import('../../services/utils/country-names.js');
const {associationNamed} = await import('../../services/utils/football-associations.js');
const {placeOfOneCountry} = await import('../../services/utils/wikidata.js');
const {titlesOfCard} = await import('../../services/utils/card-titles.js');
const {checkRewrite, neutralTitle} = await import('../../services/utils/neutral-titles.js');
const {cutPiece} = await import('../../services/utils/proofread.js');
const {withoutPreposition} = await import('../../services/utils/mentions.js');
const {chooseLetter} = await import('../../services/utils/picture-choice.js');

const corpus = JSON.parse(readFileSync(new URL('./corpus.json', import.meta.url), 'utf8'));

// what each family of the corpus asks of the logic: it throws (expect) when the case is not right
const FAMILIES = {
    language: ({input, expect: wanted}) => {
        const read = titleLanguage(input.title, input.label);
        if (wanted.language) expect(read.language).toBe(wanted.language);
        if (wanted.oneOf) expect(wanted.oneOf).toContain(read.language);
        expect(read.guessed).toBe(wanted.guessed);
    },
    // the language of a text read for itself, as the ingestion labels a news ('of': title and description, the label of the feed as the
    // default) and as the passages of an article are read to be translated ('own': the label is the language the page read gave)
    textlanguage: ({input, expect: wanted}) => {
        expect(input.via === 'own' ? ownLanguage(input.text, input.label) : languageOf(input.text, input.label)).toBe(wanted.language);
    },
    figures: ({input, expect: wanted}) => {
        expect(keepsFigures(input.original, input.translation)).toBe(wanted.keeps);
    },
    dateline: ({input, expect: wanted}) => {
        const sentences = splitSentences(input.text);
        if (wanted.first) expect(sentences[0]).toBe(wanted.first);
        if (wanted.sentences) expect(sentences).toEqual(wanted.sentences);
    },
    // a piece the AI points at in the cards of a briefing (proofread.js), taken out only when the code checks it: the text left, null when the code leaves it
    proofread: ({input, expect: wanted}) => {
        expect(cutPiece(input.text, input.piece, {kind: input.kind, part: input.part, first: input.first})).toBe(wanted.text);
    },
    // the name of a place the tagger gave with the preposition of a headline ("En Corse")
    placename: ({input, expect: wanted}) => {
        expect(withoutPreposition(input.name, input.lang)).toBe(wanted.name);
    },
    // the cut of an article into the sentences it is shown in
    sentences: ({input, expect: wanted}) => {
        expect(splitSentences(input.text)).toEqual(wanted.sentences);
    },
    names: ({input, expect: wanted}) => {
        expect(alignNames(input.text, input.names, input.original)).toBe(wanted.text);
    },
    ifthen: ({input, expect: wanted}) => {
        const saved = {cards: {1: {next: [{if: input.if, then: input.then}]}}};
        expect(withCleanNext(saved, () => new Set(input.known ?? [])).cards[1].next[0]).toEqual({if: wanted.if, then: wanted.then});
    },
    // a name in Greek or Cyrillic letters and the persons linked whose family name it spells (the rows MentionModel.personsByLooseSurname gave)
    romanized: ({input, expect: wanted}) => {
        const [linked] = withSurnamesLinked([[{qid: null, ...input.name}]], [], input.rows)[0];
        expect(linked.qid ?? null).toBe(wanted.qid);
    },
    // the names a card shows once tidied: a particle glued to a name, a declined form of a name linked, the spelling of Wikidata
    chips: ({input, expect: wanted}) => {
        const [names] = tidyNames([input.names], {stems: input.stems ?? [], labels: new Map(Object.entries(input.labels ?? {})),
            orgs: [input.orgs ?? []], nameKeys: new Map(Object.entries(input.nameKeys ?? {})), translated: [Boolean(input.translated)], reader: input.reader ?? null});
        // reader: the language of the reader, a name that is no item and is written in other letters is left out (withoutUnreadable);
        // concepts: a name linked to an item whose label has no capital letter is left out (withoutConcepts); linked: the names once the AI
        // has linked the ones that had no item, two names of one item are one (withSameItemJoined)
        const unreadable = input.reader ? withoutUnreadable(names, input.reader) : names;
        const unconcept = input.concepts ? withoutConcepts(unreadable, new Map(Object.entries(input.labels ?? {}))) : unreadable;
        const kept = input.linked ? withSameItemJoined(unconcept) : unconcept;
        expect(kept.map(name => [name.name, name.qid ?? null])).toEqual(wanted.names);
    },
    // the picture a card ends up with when the AI has rated the pictures of its articles (quality 1-5, relevance 0-2) and named the best: the
    // letter of the picture shown (lead) is kept unless the best is better by a point (see chooseLetter)
    picturechoice: ({input, expect: wanted}) => {
        expect(chooseLetter({ratings: input.ratings, best: input.best}, input.lead)).toBe(wanted.letter);
    },
    // the country the name of an organisation says by its words: it starts with a country, or has an adjective of nationality
    nationality: ({input, expect: wanted}) => {
        expect(nationalityOf(input.name, input.kind)).toBe(wanted.code);
    },
    // the association of FIFA an organisation's name says by its words, "Japan FA", "Portuguese football federation": the item it is
    // linked to without asking Wikidata, null when the name says none or several (Irish, English, Congo)
    association: ({input, expect: wanted}) => {
        expect(associationNamed(input.name)).toBe(wanted.qid);
    },
    // the country a place is by its name declined by the cases of a language ("Hiszpanii"), or by the name of a country the Intl of the
    // languages lacks ("Großbritannien")
    declined: ({input, expect: wanted}) => {
        expect(countryNamed(input.name) ?? countryDeclined(input.name, input.language ?? null)).toBe(wanted.code);
    },
    // the titles of a card given to the AI that reads the card (the countries, the check of the names): its own title first, the others after
    cardtitles: ({input, expect: wanted}) => {
        expect(titlesOfCard(input.title, input.titles).slice(0, wanted.first)).toEqual(wanted.titles);
    },
    // the item of a place called so by several items of Wikidata, when none stands out but all are of one country
    places: ({input, expect: wanted}) => {
        expect(placeOfOneCountry(input.places, new Map(Object.entries(input.countries)))).toBe(wanted.qid);
    },
    // the names chosen for a card from the rows of its articles' mentions (MentionModel.namesOfArticles)
    cardnames: ({input, expect: wanted}) => {
        expect(cardNames(input.rows, input.articles, input.options ?? {}).map(name => [name.name, name.qid ?? null])).toEqual(wanted.names);
    },
    following: ({input, expect: wanted}) => {
        expect(searchNamesFor(input.row, input.following ?? null, new Set(input.common))).toEqual(wanted.names);
    },
    neutral: ({input, expect: wanted}) => {
        if (input.removals) {
            expect(neutralTitle(input.title, input.removals)).toBe(wanted.title);
            return;
        }
        const checked = checkRewrite(input.title, input.proposal, input.passages ?? '');
        if (wanted.problem) expect(checked.problem).toBe(wanted.problem);
        else expect(checked).toEqual({text: wanted.text});
    },
};

describe('the corpus', () => {
    it('should be a real corpus: fifty cases at least, each with its family, its origin and an expectation, none twice', () => {
        expect(corpus.cases.length).toBeGreaterThanOrEqual(50);
        const ids = corpus.cases.map(one => one.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const one of [...corpus.cases, ...corpus.live]) {
            expect(typeof one.origin).toBe('string');
            expect(one.input).toBeTruthy();
            expect(one.expect).toBeTruthy();
        }
        expect(new Set(corpus.cases.map(one => one.family))).toEqual(new Set(Object.keys(FAMILIES)));
    });

    it('should have a case for each family of problem of the briefings of 6.11.2026 in each of its languages of the title', () => {
        const languages = new Set(corpus.cases.filter(one => one.family === 'language').map(one => one.expect.language ?? one.expect.oneOf[0]));
        for (const language of ['de', 'pt', 'es', 'pl', 'cs', 'sk', 'vi', 'ja', 'ar', 'th', 'el', 'mk', 'ru', 'en', 'hr']) expect(languages).toContain(language);
    });
});

for (const family of Object.keys(FAMILIES)) {
    describe(`corpus, ${family}`, () => {
        for (const one of corpus.cases.filter(item => item.family === family)) {
            // a case marked known shows a weakness of the logic: it is expected to fail, and fails when it passes (take the mark off)
            const test = one.known ? it.failing : it;
            test(`${one.id}${one.known ? ` (known: ${one.known})` : ''}`, () => FAMILIES[family](one));
        }
    });
}
