// review.txt from results.json: the organisations linked to the one item called so, the item (its classes,
// P625 position, P577 publication, P159 seat, P118 league, P641 sport, P452 industry), what the AI would
// choose instead, 3 titles. node bench/lone-organizations/review.mjs
import fs from 'node:fs';
const read = (file) => JSON.parse(fs.readFileSync(new URL(file, import.meta.url)));
const results = read('./results.json');
const classes = fs.existsSync(new URL('./classes.json', import.meta.url)) ? read('./classes.json') : {};
const label = (qid) => classes[qid]?.label ?? qid;
fs.writeFileSync(new URL('./review.txt', import.meta.url), results.filter(e => e.lone).map((e, i) => [
    `# ${i + 1} [${e.sample}] ${e.name} (${e.lang}, ${e.seen})`,
    `  I: ${e.qid} ${e.label} | ${e.links} wikis | ${e.p31.map(label).join(', ')} | ${['P625', 'P577', 'P159', 'P118', 'P641', 'P452'].filter(p => e.props.includes(p)).join(' ')} | ${e.description ?? '(no description)'}`,
    `  AI: ${e.ai ? `${e.ai.qid} ${e.ai.label} (${e.ai.links}): ${e.ai.description}` : 'none'}${e.candidates.length > 1 ? `  [of ${e.candidates.length}]` : ''}`,
    ...e.titles.slice(0, 3).map(title => `  T: ${title.slice(0, 140)}`),
].join('\n')).join('\n\n'));
console.log(`${results.filter(e => e.lone).length} lone of ${results.length}`);
