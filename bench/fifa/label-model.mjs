//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: label-model.mjs
//  Description: The third labeller of the gold set of the map of the FIFA presidency (bench/fifa/GUIDE.md): a model of another family than
//               the two Claude labellers, given the guide and one passage at a time, so that a label two of three agree on can be told
//               from one that only one gives. Writes data/labels-<name>-<n>.json like the others; an answer that breaks a rule of the
//               guide is asked again once with the problems named, then left out (the adjudication counts it as no vote)
//
//  node --env-file=.env bench/fifa/label-model.mjs [model=deepseek-v4-pro] [name=C]
//

import {readFileSync, writeFileSync} from 'node:fs';
import process from 'node:process';
import {mapWithConcurrency} from '../../services/utils/concurrency.js';
import {newUsage, ollamaJson} from '../../services/utils/ollama.js';
import {BATCHES, dataFile, labelPrompt, problemsOf} from './labels.mjs';

const [MODEL = 'deepseek-v4-pro', NAME = 'C'] = process.argv.slice(2);
const usage = newUsage();
const promptOf = labelPrompt;

let kept = 0, left = 0;
for (let n = 1; n <= BATCHES; n++) {
    const items = JSON.parse(readFileSync(dataFile(`label-input-${n}.json`), 'utf8'));
    const labels = (await mapWithConcurrency(items, 4, async (item) => {
        let problems = null;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const answer = await ollamaJson(promptOf(item, problems), usage, {model: MODEL, think: true, timeoutMs: 240000, fallback: null});
                const label = {...answer, id: item.id};
                problems = problemsOf(label);
                if (problems.length === 0) return label;
            } catch (error) {
                problems = [`the answer was not usable (${String(error.message).slice(0, 80)})`];
            }
        }
        return null;
    })).map(result => result.status === 'fulfilled' ? result.value : null).filter(Boolean);
    kept += labels.length;
    left += items.length - labels.length;
    writeFileSync(dataFile(`labels-${NAME}-${n}.json`), JSON.stringify(labels, null, 1));
    console.log(`batch ${n}: ${labels.length}/${items.length} labels (${usage.calls} calls, ${usage.input} in, ${usage.output} out so far)`);
}
console.log(`${NAME} (${MODEL}): ${kept} labels, ${left} left out; ${usage.calls} calls, ${usage.input} tokens in, ${usage.output} out`);
