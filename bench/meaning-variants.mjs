// the "related" rule of the search by sentence, variants side by side on the same candidates as the
// production (FeedModel.closestArticles, one line per story), each variant asked twice.
// node bench/meaning-variants.mjs [--fresh]   -> bench/data/meaning-variants/{candidates,answers}.json + report.txt
import 'dotenv/config';
import fs from 'node:fs';
import Links from '../services/utils/links.js';
import {FeedModel} from '../models/feed-model.js';
import {embed, toSparsevec, toVector} from '../services/utils/embedder.js';
import {newUsage, ollamaJson} from '../services/utils/ollama.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';
import {searchPrompt, normalizeSorting} from '../services/utils/search-ai.js';

const DIR = 'bench/data/meaning-variants';
fs.mkdirSync(DIR, {recursive: true});
const PHRASES = [
    ['fr', "les décisions de l'arbitrage vidéo en Ligue des champions"],
    ['fr', "la hausse des prix de l'énergie"],
    ['fr', 'PSG'],
    ['fr', "l'intelligence artificielle à l'hôpital"],
    ['fr', 'du football mais pas le PSG'],
    ['fr', 'les tensions entre la Chine et Taïwan'],
    ['fr', 'Mbappé blessure'],
    ['fr', 'ce que le pape a dit pendant sa visite en France'],
    ['fr', 'Achraf Hakimi'],
    ['en', 'electric car sales in China'],
    ['en', 'Federal Reserve interest rate decision'],
    ['en', 'wildfires'],
    ['en', 'new AI models released this week'],
    ['en', 'last ai models for programming'],
];
const RUNS = Number(process.env.RUNS) || 2;

// A: the prompt before 28.09 (the push to short lists), C: the production one since
const SHORT = " Des listes courtes, ou vides, valent mieux qu'un article hors sujet.";
const A = (query, candidates) => searchPrompt(query, candidates)
    .replace('Juge seulement sur le titre et la description.', `Juge seulement sur le titre et la description.${SHORT}`);
// without the push to short lists
const C = (query, candidates) => A(query, candidates)
    .replace(' Des listes courtes, ou vides, valent mieux qu\'un article hors sujet.', '');
// + the same subject without the precision of the sentence counts as related
const B = (query, candidates) => C(query, candidates)
    .replace('(une autre précision, un autre lieu, un autre aspect).', '(une autre précision, un autre lieu, un autre aspect, ou le même sujet sans la précision de sa phrase).');
const VARIANTS = Object.fromEntries(Object.entries({A, C, B})
    .filter(([name]) => !process.env.VARIANTS || process.env.VARIANTS.split(',').includes(name)));
const probe = [{id: '1', title: 't', description: ''}];
if (C('q', probe) === A('q', probe) || B('q', probe) === C('q', probe)) throw new Error('a variant did not change the prompt');

// 1. the candidates, kept on disk so every variant reads the same ones
const candidatesFile = `${DIR}/candidates.json`;
let candidates;
if (!process.argv.includes('--fresh') && fs.existsSync(candidatesFile)) {
    candidates = JSON.parse(fs.readFileSync(candidatesFile, 'utf8'));
} else {
    const vectors = await embed(PHRASES.map(([, phrase]) => phrase));
    candidates = [];
    for (const [i, [lang, phrase]] of PHRASES.entries()) {
        const rows = await FeedModel.closestArticles({
            feedUrls: Links.getCategoriesLinks(Links.categories(lang), lang),
            timeframe: {start: new Date(Date.now() - 7 * 86400e3)},
            dense: toVector(vectors[i].dense), sparse: toSparsevec(vectors[i].sparse),
            sparseWeight: 0.5, byMeaning: 80, byWords: 30,
        });
        const byKey = new Map();
        for (const a of rows) {
            const key = a.id_story != null ? `story ${a.id_story}` : `title ${a.title}`;
            if (!byKey.has(key)) byKey.set(key, a);
        }
        candidates.push({lang, phrase, lines: [...byKey.values()].map(a => ({id: String(a.id), title: a.title, description: a.description ?? ''}))});
    }
    fs.writeFileSync(candidatesFile, JSON.stringify(candidates, null, 1));
}

// 2. the answers, each variant RUNS times (temperature 0.1 still varies)
const answersFile = `${DIR}/answers.json`;
const answers = fs.existsSync(answersFile) && !process.argv.includes('--fresh') ? JSON.parse(fs.readFileSync(answersFile, 'utf8')) : {};
const usage = newUsage();
const clean = (d) => d.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
const jobs = candidates.flatMap(({phrase, lines}) => Object.entries(VARIANTS).flatMap(([name, prompt]) =>
    [...Array(RUNS).keys()].map(run => ({key: `${name}${run} ${phrase}`, phrase, lines, prompt}))));
await mapWithConcurrency(jobs.filter(job => !answers[job.key]), 2, async ({key, phrase, lines, prompt}) => {
    const text = prompt(phrase, lines.map(l => ({...l, description: clean(l.description)})));
    const answer = await ollamaJson(text, usage).catch(() => ollamaJson(text, usage));
    answers[key] = normalizeSorting(answer, lines.map(l => l.id));
    fs.writeFileSync(answersFile, JSON.stringify(answers, null, 1));
});
fs.writeFileSync(answersFile, JSON.stringify(answers, null, 1));

// 3. the report: counts, then every line some variant kept and another did not
const out = [];
const status = (name, phrase, id) => {
    const marks = [...Array(RUNS).keys()].map(run => {
        const a = answers[`${name}${run} ${phrase}`];
        return a.answers.includes(id) ? 'A' : a.related.includes(id) ? 'r' : '.';
    });
    return marks.join('');
};
for (const {phrase, lines} of candidates) {
    const counts = Object.keys(VARIANTS).map(name => `${name} ${[...Array(RUNS).keys()].map(run => {
        const a = answers[`${name}${run} ${phrase}`];
        return `${a.answers.length}+${a.related.length}`;
    }).join('/')}`);
    out.push(`\n=== ${phrase} (${lines.length} lines)  ${counts.join('   ')}`);
    for (const l of lines) {
        const s = Object.keys(VARIANTS).map(name => status(name, phrase, l.id));
        if (s.every(x => x === '.'.repeat(RUNS))) continue;
        const same = s.every(x => x === s[0]);
        out.push(`${same ? '  ' : '* '}${s.join(' ')}  [${l.id}] ${l.title.slice(0, 100)} — ${clean(l.description).slice(0, 90)}`);
    }
}
out.push(`\ntokens ${usage.input}+${usage.output}, ${usage.calls} calls`);
fs.writeFileSync(`${DIR}/report.txt`, out.join('\n'));
console.log(out.join('\n'));
process.exit(0);
