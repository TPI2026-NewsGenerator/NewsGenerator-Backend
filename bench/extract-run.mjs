// the key passages of the faithfulness bench: node bench/extract-run.mjs [name]
// the reader is French for the fr and enfr articles, English for the en ones
import 'dotenv/config';
import fs from 'node:fs';
import {extractArticle, sentencesOf} from '../services/utils/extract.js';
import {newUsage} from '../services/utils/ollama.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';

const name = process.argv[2] ?? 'extract';
const articles = JSON.parse(fs.readFileSync(new URL('./data/faithful/articles.json', import.meta.url), 'utf8'));
const usage = newUsage();
const reader = (id) => id.startsWith('en') && !id.startsWith('enfr') ? 'en' : 'fr';
const results = await mapWithConcurrency(articles, 2, async (a) => {
    const r = await extractArticle(a.title, {content: a.text, blocks: a.blocks}, {language: reader(a.id), usage});
    const sentences = sentencesOf({content: a.text, blocks: a.blocks}).map(s => s.text);
    // every sentence shown must be one of the article's, word for word
    const verbatim = r.passages.flat().every(s => sentences.includes(s.text));
    return {id: a.id, sentences: sentences.length, verbatim, ...r};
});
const out = results.map((r, i) => r.status === 'fulfilled' ? r.value : {id: articles[i].id, error: String(r.reason)});
fs.writeFileSync(new URL(`./data/faithful/${name}.json`, import.meta.url), JSON.stringify(out, null, 1));
console.log(`tokens ${JSON.stringify(usage)}`);
for (const r of out) console.log(`${r.id}: ${r.sentences} sentences, ${r.passages?.length} passages, ${r.passages?.flat().map(s => s.text).join(' ').split(/\s+/).length} words, verbatim ${r.verbatim}, translated ${r.translation ? 'yes' : 'no'} ${r.error ?? ''}`);
process.exit(0);
