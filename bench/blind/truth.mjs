// truth.txt (the judgments, written before any system ran) as truth.json: {i: {right: [qid], near: [qid], unsure}}, the
// numbers of judge.txt turned into the qids of items.json. node bench/blind/truth.mjs
import fs from 'node:fs';
const items = JSON.parse(fs.readFileSync(new URL('./items.json', import.meta.url), 'utf8'));
const truth = {};
for (const line of fs.readFileSync(new URL('./truth.txt', import.meta.url), 'utf8').split('\n')) {
    const match = line.match(/^(\d+): r=([\d,]*)(?: c=([\d,]*))?( \?)?$/);
    if (!match) continue;
    const item = items[Number(match[1])];
    const qid = (n) => item.candidates[Number(n) - 1]?.qid;
    truth[match[1]] = {right: match[2].split(',').filter(Boolean).map(qid), near: (match[3] ?? '').split(',').filter(Boolean).map(qid), unsure: Boolean(match[4])};
}
fs.writeFileSync(new URL('./truth.json', import.meta.url), JSON.stringify(truth));
const all = Object.values(truth);
console.log(`${all.length} judged: ${all.filter(t => t.right.length > 0).length} with an item right among the candidates, ${all.filter(t => t.right.length === 0).length} with none, ${all.filter(t => t.unsure).length} unsure`);
