// The sample and what each way found, one block a name, to be judged by hand into truth.json
// ({id: "W" | "P1" | "P2" | "P3" | "Q1" | "E1" | ... | "none" | "unsure"}: which answer is the item the news mean).
// node --env-file=.env bench/wiki-search/review.mjs > bench/wiki-search/review.txt
import fs from 'node:fs';

const sample = JSON.parse(fs.readFileSync(new URL('./sample.json', import.meta.url), 'utf8'));
const {results, items} = JSON.parse(fs.readFileSync(new URL('./results.json', import.meta.url), 'utf8'));
const byId = new Map(results.map(out => [out.id, out]));
const show = (qid) => {
    const item = items[qid];
    if (!item) return qid ?? '-';
    return `${item.label} (${item.description || 'no description'}; ${item.links} wikis${item.human ? '; human' : ''}${item.place ? '; place' : ''}${item.work ? '; work' : ''})`;
};
const hits = (list) => (list ?? []).slice(0, 3).map((hit, i) => `    ${i + 1}. ${hit.title}${hit.disambiguation ? ' [homonyms]' : ''} -> ${hit.qid ? show(hit.qid) : 'no item'}`).join('\n') || '    -';
sample.forEach((row, i) => {
    const out = byId.get(row.id);
    console.log(`#${row.id} [${i + 1}] ${row.kind} "${row.name}" (${row.lang}, ${row.seen} news)`);
    for (const title of row.titles) console.log(`  news: ${title.slice(0, 110)}`);
    console.log(`  W: ${row.qid ? show(row.qid) : 'none'}`);
    console.log(`  P plain:\n${hits(out?.plain)}`);
    console.log(`  Q quoted:\n${hits(out?.quoted)}`);
    if (out?.english) console.log(`  E english:\n${hits(out.english)}`);
    console.log('');
});
