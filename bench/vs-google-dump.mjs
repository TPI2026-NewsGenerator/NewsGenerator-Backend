// the titles of both sides of a vs-google run, to judge them by hand
// node bench/vs-google-dump.mjs <file> [query index]
import fs from 'node:fs';
const {queries} = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const only = process.argv[3] === undefined ? null : Number(process.argv[3]);
queries.forEach((q, i) => {
    if (only !== null && i !== only) return;
    console.log(`\n##### ${i} [${q.language}] ${q.text}${q.web ? ' (web)' : ''} — ours ${q.ours.length}, Google ${q.googleTotal}`);
    console.log('--- ours');
    q.ours.forEach((n, j) => console.log(`${j} ${n.match === 'answer' ? 'A' : 'r'} ${n.title.slice(0, 110)} | ${n.source ?? ''}`));
    console.log('--- google');
    q.google.forEach((n, j) => console.log(`${j} ${n.known ? '*' : ' '} ${n.title.slice(0, 110)} | ${n.site}`));
});
