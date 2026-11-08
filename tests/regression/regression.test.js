//
//  Author: Fabian Rostello
//  Date: 06.11.2026
//  File: regression.test.js
//  Description: The corpus of regression of the briefing, offline: every case of tests/regression/corpus.json run through the logic that
//               has no AI (the language of a title, the check of the figures of a translation, the dateline, the spelling of the names,
//               the small letter after "If", the names a person is followed by, the checks of a neutral title). A test a case, named by
//               it. A problem reported on a card adds its case to the corpus first, then the logic is fixed (see README.md)
//

import {readFileSync} from 'node:fs';
import {describe, expect, it, jest} from '@jest/globals';

// nothing is asked of the AI here, but the modules that ask it are loaded
jest.unstable_mockModule('ollama', () => ({Ollama: jest.fn(() => ({chat: jest.fn()}))}));
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));

const {titleLanguage} = await import('../../services/utils/language.js');
const {keepsFigures, splitSentences} = await import('../../services/utils/extract.js');
const {alignNames} = await import('../../services/utils/spellings.js');
const {withCleanNext} = await import('../../services/utils/card-analysis.js');
const {searchNamesFor} = await import('../../services/utils/watch-names.js');
const {tidyNames, withSurnamesLinked} = await import('../../services/utils/card-names.js');
const {checkRewrite, neutralTitle} = await import('../../services/utils/neutral-titles.js');

const corpus = JSON.parse(readFileSync(new URL('./corpus.json', import.meta.url), 'utf8'));

// what each family of the corpus asks of the logic: it throws (expect) when the case is not right
const FAMILIES = {
    language: ({input, expect: wanted}) => {
        const read = titleLanguage(input.title, input.label);
        if (wanted.language) expect(read.language).toBe(wanted.language);
        if (wanted.oneOf) expect(wanted.oneOf).toContain(read.language);
        expect(read.guessed).toBe(wanted.guessed);
    },
    figures: ({input, expect: wanted}) => {
        expect(keepsFigures(input.original, input.translation)).toBe(wanted.keeps);
    },
    dateline: ({input, expect: wanted}) => {
        const sentences = splitSentences(input.text);
        if (wanted.first) expect(sentences[0]).toBe(wanted.first);
        if (wanted.sentences) expect(sentences).toEqual(wanted.sentences);
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
            orgs: [input.orgs ?? []], nameKeys: new Map(Object.entries(input.nameKeys ?? {}))});
        expect(names.map(name => [name.name, name.qid ?? null])).toEqual(wanted.names);
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
