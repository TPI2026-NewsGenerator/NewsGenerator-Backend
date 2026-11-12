//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: labels.mjs
//  Description: The labels of the gold set of the map of the FIFA presidency (services/utils/fifa-guide.md): the closed words, the checks a label
//               must pass, and the batches handed to the labellers (the passages with nothing the pipeline decided: no model answer, no
//               census flag). The labellers write bench/fifa/data/labels-<name>-<n>.json, one array of labels per batch.
//
//  node bench/fifa/labels.mjs batches            writes data/label-input-<n>.json from data/pool.json
//  node bench/fifa/labels.mjs check <files...>   checks label files: closed words, the rules of the guide, coverage of the batch
//

import {readFileSync, writeFileSync} from 'node:fs';
import process from 'node:process';
import {BINDING, VOCAB, problemsOf, statusOf} from '../../services/utils/fifa-labels.js';

export {BINDING, VOCAB, problemsOf, statusOf};
export const BATCHES = 4;

export const dataFile = (name) => new URL(`./data/${name}`, import.meta.url);

// The prompt a model labels with: the guide, then the passage (what label-model.mjs and the variants of run.mjs ask)
const GUIDE = readFileSync(new URL('../../services/utils/fifa-guide.md', import.meta.url), 'utf8');
export const labelPrompt = (item, problems = null) => `${GUIDE}

---
Label this passage by the guide above. Answer with the JSON object of the label only (no other text), with exactly the fields: id, about_election, association_ok, speaker_kind, stance, toward, mark, level, status, reason, confidence, note, quote (the exact words, copied from the sentence, the title or the description, that show the stance of the association; "" when there are none).${problems ? `\n\nYour previous answer broke the rules of the guide: ${problems.join('; ')}. Correct it.` : ''}

${JSON.stringify(item, null, 1)}`;

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
    const [command, ...files] = process.argv.slice(2);
    const pool = JSON.parse(readFileSync(dataFile('pool.json'), 'utf8')).passages;
    if (command === 'batches') {
        const size = Math.ceil(pool.length / BATCHES);
        for (let n = 0; n < BATCHES; n++) {
            const part = pool.slice(n * size, (n + 1) * size).map(p => ({
                id: p.id, candidate: p.subject.name,
                association: {name: p.member.name, kind: p.member.level, country: p.member.country, fifaCode: p.member.fifa, acronyms: p.member.acronyms},
                matchedName: p.matched,
                sentence: p.sentence,
                article: {title: p.article.title, description: p.article.description, medium: p.article.medium, language: p.article.lang, date: p.article.date},
            }));
            writeFileSync(dataFile(`label-input-${n + 1}.json`), JSON.stringify(part, null, 1));
            console.log(`label-input-${n + 1}.json: ${part.length} passages`);
        }
    } else if (command === 'check') {
        const byId = new Map(pool.map(p => [p.id, p]));
        for (const file of files) {
            const labels = JSON.parse(readFileSync(file, 'utf8'));
            let bad = 0;
            for (const label of labels) {
                const problems = byId.has(label?.id) ? problemsOf(label) : ['id is not in the pool'];
                if (problems.length > 0) { bad++; console.log(`  ${label?.id}: ${problems.join('; ')}`); }
            }
            const ids = new Set(labels.map(l => l.id));
            console.log(`${file.split(/[\\/]/).pop()}: ${labels.length} labels, ${bad} with a problem, ${ids.size === labels.length ? 'no id twice' : 'AN ID TWICE'}`);
        }
    } else {
        console.log('usage: node bench/fifa/labels.mjs batches | check <files...>');
    }
}
