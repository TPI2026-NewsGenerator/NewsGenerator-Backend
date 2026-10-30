import 'dotenv/config';
import fs from 'node:fs';
import {splitSentences, buildExtract, keepsFigures} from '../services/utils/extract.js';
import {ollamaJson} from '../services/utils/ollama.js';
const a = JSON.parse(fs.readFileSync(new URL('./data/faithful/articles.json', import.meta.url), 'utf8'));
const r = JSON.parse(fs.readFileSync(new URL('./data/faithful/extract.json', import.meta.url), 'utf8'));
for (const id of ['enfr7', 'enfr8']) {
    const x = r.find(y => y.id === id);
    const sentences = x.passages.flat();
    const answer = await ollamaJson(`Translate these sentences of a news article from English into French.
Translate each one faithfully and completely: the same facts, the same figures, the same names, the
same certainty (may, reportedly, alleged, planned), nothing added and nothing left out. Names of
people, organisations and places stay as they are.

${sentences.map((s, i) => `[${i + 1}] ${s}`).join('\n')}

Answer only in JSON: {"translations": ["...", one per sentence, in the same order]}`);
    console.log(`\n## ${id} ${sentences.length} sentences, ${answer.translations?.length} translations`);
    sentences.forEach((s, i) => { const t = answer.translations?.[i] ?? ''; if (!keepsFigures(s, t)) console.log(`FIGURES LOST\n  ${s}\n  ${t}`); });
}
for (const id of ['enfr9', 'en4']) console.log(`\n## ${id} first sentences:\n${splitSentences(a.find(y => y.id === id).text).slice(0, 6).join('\n')}`);
process.exit(0);
