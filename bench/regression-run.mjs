// The corpus of regression, live: the cases "live" of tests/regression/corpus.json asked of the real model (the translation of titles and
// of passages with their dates, names and figures, the rewrite of a title). Before a deploy, or after a change of the prompts or of the
// model. Each case is checked by what it must hold (a month, a name spelled as Wikidata spells it, a language, an answer that is never
// silent), not by an exact text: the AI does not write twice the same. The scorecard is saved in bench/data/regression/ and compared
// with the last one: what passed and fails now, what failed and passes
//
// node --env-file=.env bench/regression-run.mjs [--only=live-translate-vi-hdbank,...] [--no-save] [--soft] [--corpus=other.json]
// (--soft: the exit code stays 0 when a case fails)
import process from 'node:process';
import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {bestRewrite} from '../services/utils/neutral-titles.js';
import {ORIGINAL_START, translatePassages, translateTexts} from '../services/utils/extract.js';
import {languageOf} from '../services/utils/language.js';
import {translatedTitles} from '../services/utils/title-translation.js';
import {newUsage} from '../services/utils/ollama.js';

const flags = Object.fromEntries(process.argv.slice(2).filter(arg => arg.startsWith('--')).map(arg => arg.slice(2).split('=')));
const corpus = JSON.parse(readFileSync(flags.corpus ?? new URL('../tests/regression/corpus.json', import.meta.url), 'utf8'));
const only = flags.only ? new Set(flags.only.split(',')) : null;
const CODES = {English: 'en', Spanish: 'es', French: 'fr', German: 'de', Italian: 'it'};

// what each family asks of the real model: {output, ...} the text it gave, null when it gave none that holds
const ASK = {
    translate: async ({input}, usage) => {
        if (input.sentences) {
            const done = await translatePassages([input.sentences.map(text => ({text, quote: false}))], input.from, input.to, usage, {names: input.names ?? []});
            // a sentence left in its language between parentheses is marked: the translation did not hold
            return done === null || done.flat().some(sentence => sentence.text.includes(ORIGINAL_START)) ? {output: null} : {output: done.flat().map(sentence => sentence.text).join(' ')};
        }
        const done = await translateTexts(input.texts.map(text => ({text, from: input.from, names: input.names ?? [], glossary: []})), input.to, usage);
        return {output: done.some(text => text === null) ? null : done.join(' | ')};
    },
    rewrite: async ({input}, usage) => {
        const answer = await bestRewrite(input.title, input.passages, usage, {language: input.language});
        return {answer, output: answer.title ?? answer.proposal ?? null};
    },
    // the language of a title with the label of its feed wrong: what the words and the letters guess, and what the AI that translates it says
    languages: async ({input}, usage) => {
        const [answer] = await translatedTitles([{title: input.title, label: input.label}], CODES[input.to], usage);
        return {answer, output: answer.language};
    },
};

// what a case must hold: [{name, ok, detail}]
const CHECKS = {
    translate: ({input, expect: wanted}, {output}) => [
        {name: 'kept', ok: wanted.kept ? output !== null : true, detail: output === null ? 'no translation that holds (a figure lost, a sentence left)' : ''},
        ...(output === null ? [] : [
            ...(wanted.contains ?? []).map(text => ({name: `has "${text}"`, ok: output.includes(text), detail: output})),
            ...(wanted.excludes ?? []).map(text => ({name: `has not "${text}"`, ok: !output.includes(text), detail: output})),
            ...(wanted.language ? [{name: `is ${wanted.language}`, ok: [wanted.language, null].includes(languageOf(output)), detail: `read ${languageOf(output)}: ${output}`}] : []),
        ]),
    ],
    languages: ({expect: wanted}, {answer}) => [
        ...(wanted.language ? [{name: `is ${wanted.language}`, ok: answer.language === wanted.language, detail: `read ${answer.language}`}] : []),
        ...(wanted.oneOf ? [{name: `is one of ${wanted.oneOf.join(', ')}`, ok: wanted.oneOf.includes(answer.language), detail: `read ${answer.language}`}] : []),
        {name: wanted.translated ? 'translated' : 'kept as it is', ok: wanted.translated ? Boolean(answer.translation) : answer.translation === null, detail: String(answer.translation)},
    ],
    rewrite: ({expect: wanted}, {answer, output}) => [
        ...(wanted.answered ? [{name: 'answered, never silent', ok: Boolean(output) || answer.reason === 'same', detail: JSON.stringify(answer)}] : []),
        ...(wanted.same ? [{name: 'neutral already', ok: answer.reason === 'same', detail: JSON.stringify(answer)}] : []),
        ...(wanted.excludes ?? []).map(text => ({name: `has not "${text}"`, ok: !String(output ?? '').includes(text), detail: String(output)})),
    ],
};

const usage = newUsage();
const results = [];
for (const one of corpus.live.filter(item => !only || only.has(item.id))) {
    const started = Date.now();
    try {
        const got = await ASK[one.family](one, usage);
        const checks = CHECKS[one.family](one, got);
        results.push({id: one.id, family: one.family, ok: checks.every(check => check.ok), checks, output: got.output, ms: Date.now() - started});
    } catch (err) {
        results.push({id: one.id, family: one.family, ok: false, checks: [{name: 'ran', ok: false, detail: err.message}], output: null, ms: Date.now() - started});
    }
    const last = results.at(-1);
    console.log(`${last.ok ? 'ok  ' : 'FAIL'} ${last.id} (${(last.ms / 1000).toFixed(1)} s)`);
    for (const check of last.checks.filter(item => !item.ok)) console.log(`       ✗ ${check.name}${check.detail ? ` — ${String(check.detail).slice(0, 220)}` : ''}`);
}

const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length} of ${results.length} live cases hold, tokens ${JSON.stringify(usage)}`);

// compared with the last scorecard saved
const dir = new URL('./data/regression/', import.meta.url);
const previous = existsSync(dir) ? readdirSync(dir).filter(name => /^live-.*\.json$/.test(name)).sort().at(-1) : null;
if (previous) {
    const before = new Map(JSON.parse(readFileSync(new URL(previous, dir), 'utf8')).results.map(result => [result.id, result.ok]));
    const worse = results.filter(result => !result.ok && before.get(result.id) === true).map(result => result.id);
    const better = results.filter(result => result.ok && before.get(result.id) === false).map(result => result.id);
    console.log(`since ${previous}: ${worse.length} fail now that held (${worse.join(', ') || '-'}), ${better.length} hold now that failed (${better.join(', ') || '-'})`);
}
if (!('no-save' in flags) && !only) {
    mkdirSync(dir, {recursive: true});
    writeFileSync(new URL(`live-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, dir), JSON.stringify({at: new Date().toISOString(), usage, results}, null, 1));
}
process.exit(failed.length > 0 && !('soft' in flags) ? 1 : 0);
