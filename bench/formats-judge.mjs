// The outputs of formats-run.mjs set beside their article, to be judged statement by statement:
// node bench/formats-judge.mjs <dir> [per file] [pieces]   writes <dir>/judge-<n>.md, 5 articles each
// by default; with 'pieces', the outputs of formats-pieces.mjs instead (E points, F summary, 2 runs).
// What the AI was shown (the numbered sentences) is what each output is judged against
import fs from 'node:fs';
import path from 'node:path';
import {sentencesOf} from '../services/utils/extract.js';

const [dir, per = '5', mode] = process.argv.slice(2);
const read = (name) => JSON.parse(fs.readFileSync(new URL(`./data/faithful/${name}`, import.meta.url), 'utf8'));
const articles = read('articles.json');
const runs = mode === 'pieces' ? [read('pieces-1.json'), read('pieces-2.json')] : [read('formats-1.json'), read('formats-2.json')];

const piecesPacket = (a) => {
    const sentences = sentencesOf({content: a.text, blocks: a.blocks});
    const outputs = runs.map(run => run.find(r => r.id === a.id)).flatMap((r, i) => [
        `### E${i + 1} — copied points, run ${i + 1}${r?.pointsOriginal ? ' (machine translated)' : ''}  (from sentences ${JSON.stringify(r?.pointsFrom)})
${r?.points?.length ? r.points.map(p => `- ${p}`).join('\n') : '(none)'}
${r?.pointsOriginal ? `Originals:\n${r.pointsOriginal.map(p => `- ${p}`).join('\n')}` : ''}`,
        `### F${i + 1} — copied summary, run ${i + 1}${r?.summaryOriginal ? ' (machine translated)' : ''}  (from sentences ${JSON.stringify(r?.summaryFrom)})
${r?.summary || '(none)'}
${r?.summaryOriginal ? `Original: ${r.summaryOriginal}` : ''}`,
    ]);
    return `## ${a.id} — reader writes ${reader(a.id)}

TITLE: ${a.title}

ARTICLE SENTENCES (what the AI was shown):
${sentences.map((s, i) => `[${i + 1}]${s.quote ? ' (quote)' : ''} ${s.text}`).join('\n')}

${outputs.join('\n\n')}
`;
};
const reader = (id) => id.startsWith('en') && !id.startsWith('enfr') ? 'English' : 'French';

const packet = (a) => {
    const [one, two] = runs.map(run => run.find(r => r.id === a.id));
    const sentences = sentencesOf({content: a.text, blocks: a.blocks});
    const points = (r) => r?.aiPoints?.length ? r.aiPoints.map(p => `- ${p.text}  (from ${JSON.stringify(p.from)})`).join('\n') : '(none)';
    const pub = one?.pub;
    return `## ${a.id} — reader writes ${one?.reader === 'en' ? 'English' : 'French'}

TITLE: ${a.title}

ARTICLE SENTENCES (what the AI was shown):
${sentences.map((s, i) => `[${i + 1}]${s.quote ? ' (quote)' : ''} ${s.text}`).join('\n')}

### A1 — AI points, run 1
${points(one)}

### A2 — AI points, run 2
${points(two)}

### B1 — AI summary, run 1  (from ${JSON.stringify(one?.aiSummaryFrom)})
${one?.aiSummary ?? '(none)'}

### B2 — AI summary, run 2  (from ${JSON.stringify(two?.aiSummaryFrom)})
${two?.aiSummary ?? '(none)'}

### C — published points (sentences of the article${pub?.pointsOriginal ? ', machine translated' : ''})
${pub?.points?.length ? pub.points.map(p => `- ${p}`).join('\n') : '(none)'}
${pub?.pointsOriginal ? `Originals:\n${pub.pointsOriginal.map(p => `- ${p}`).join('\n')}` : ''}

### D — published summary (sentences of the article${pub?.summaryOriginal ? ', machine translated' : ''})
${pub?.summary || '(none)'}
${pub?.summaryOriginal ? `Original: ${pub.summaryOriginal}` : ''}
`;
};

fs.mkdirSync(dir, {recursive: true});
for (let i = 0; i < articles.length; i += Number(per)) {
    const file = path.join(dir, `judge-${i / Number(per) + 1}.md`);
    fs.writeFileSync(file, articles.slice(i, i + Number(per)).map(mode === 'pieces' ? piecesPacket : packet).join('\n\n---\n\n'));
    console.log(file);
}
