// The outputs of formats-models.mjs set beside their article, the models hidden, to be judged statement
// by statement: node bench/formats-models-judge.mjs <dir> [per file]
//   writes <dir>/judge-<n>.md (3 articles each by default) and <dir>/key.json (which model is which
//   M<n> for each article, shuffled per article so that no judge learns a model's style by its letter)
// Each model gives P1, P2 (its AI points, runs 1 and 2) and S1, S2 (its AI summary, cut in the numbered
// sentences the grounded check judged). What the AI was shown is what each output is judged against.
import fs from 'node:fs';
import path from 'node:path';
import {sentencesOf} from '../services/utils/extract.js';

const MODELS = ['gemma4:31b', 'deepseek-v4-pro:0813', 'kimi-k3', 'mistral-large-3:675b', 'deepseek-v4.1-flash'];
const [dir, per = '3'] = process.argv.slice(2);
const read = (name) => JSON.parse(fs.readFileSync(new URL(`./data/faithful/${name}`, import.meta.url), 'utf8'));
const articles = read('articles.json');
const runs = Object.fromEntries(MODELS.map(m => [m, [1, 2].map(run => read(`models-${m.replace(/[:.]/g, '-')}-${run}.json`).results)]));
const readerOf = (id) => id.startsWith('en') && !id.startsWith('enfr') ? 'English' : 'French';

// the same order for an article from one call to the next (a seed of its id)
const shuffled = (list, seed) => {
    let h = [...seed].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7);
    const random = () => (h = (h * 1103515245 + 12345) >>> 0) / 2 ** 32;
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
};

const key = {};
const packet = (a) => {
    const sentences = sentencesOf({content: a.text, blocks: a.blocks});
    const order = shuffled(MODELS, a.id);
    key[a.id] = Object.fromEntries(order.map((m, i) => [`M${i + 1}`, m]));
    const outputs = order.flatMap((m, i) => {
        const [one, two] = runs[m].map(results => results.find(r => r.id === a.id));
        const points = (r) => r?.aiPoints?.length ? r.aiPoints.map((p, n) => `${n + 1}. ${p.text}`).join('\n') : '(none)';
        const summary = (r) => r?.aiSummaryParts?.length ? r.aiSummaryParts.map((s, n) => `${n + 1}. ${s}`).join('\n') : '(none)';
        return [
            `### M${i + 1}-P1 — points\n${points(one)}`,
            `### M${i + 1}-P2 — points\n${points(two)}`,
            `### M${i + 1}-S1 — summary (one paragraph, its sentences numbered)\n${summary(one)}`,
            `### M${i + 1}-S2 — summary (one paragraph, its sentences numbered)\n${summary(two)}`,
        ];
    });
    return `## ${a.id} — the reader reads ${readerOf(a.id)}

TITLE: ${a.title}

ARTICLE SENTENCES (what the AI was shown):
${sentences.map((s, i) => `[${i + 1}]${s.quote ? ' (quote)' : ''} ${s.text}`).join('\n')}

${outputs.join('\n\n')}
`;
};

fs.mkdirSync(dir, {recursive: true});
for (let i = 0; i < articles.length; i += Number(per)) {
    const file = path.join(dir, `judge-${i / Number(per) + 1}.md`);
    fs.writeFileSync(file, articles.slice(i, i + Number(per)).map(packet).join('\n\n---\n\n'));
    console.log(file);
}
fs.writeFileSync(path.join(dir, 'key.json'), JSON.stringify(key, null, 1));
