// The AI of organizationItem (organizationPrompt: the titles of the news, the items called so) on the cases of
// the context bench, whatever rule kept an item before: what it chooses against the judged items. Writes
// ai.json. node --env-file=.env bench/context/ai.mjs [extras|all]
import fs from 'node:fs';
import {ollamaJson} from '../../services/utils/ollama.js';
import {organizationPrompt} from '../../services/utils/organization-items.js';
import {outcome} from './score.mjs';

const read = (file) => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const cases = read('./cases.json').filter(c => process.argv[2] === 'all' || c.suite === 'extras');
const tally = {right: 0, country: 0, wrong: 0, other: 0, lost: 0};
const out = [];
for (const c of cases) {
    const items = c.candidates.filter(item => !/^(Wikimedia |family name)/i.test(item.description ?? '')).slice(0, 10);
    const answer = await ollamaJson(organizationPrompt(c.name, c.titles, items), null);
    const chosen = items[Number(answer?.n) - 1];
    const pick = chosen && chosen.links >= 1 ? chosen.qid : null;
    const result = outcome(c, pick);
    tally[result]++;
    out.push({name: c.name, lang: c.lang, suite: c.suite, pick, result});
    if (result !== 'right') console.log(`${result}\t${c.name} [${c.lang}]${c.card ? ' card' : ''}: AI ${pick ? `${pick} ${chosen.label}` : 'none'}, right ${c.right.join('/') || 'none'}`);
}
fs.writeFileSync(new URL('./ai.json', import.meta.url), JSON.stringify(out));
console.log(JSON.stringify(tally));
