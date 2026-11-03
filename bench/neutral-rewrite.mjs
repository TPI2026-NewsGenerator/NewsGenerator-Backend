// The neutral title the AI proposes in the editor of the e-mail (rewrittenTitle, services/utils/neutral-titles.js), asked for
// the titles of the cards of the briefings of the last days: how many are proposed, left as they are or refused by the checks
// of the code, and every one to be read by hand. The titles with a mark of the medium (an exclamation mark, a word of judgment)
// are half of the sample, they are the ones the reader will ask for. The sample is the same from one run to the next, so two
// settings can be read against each other.
//   node --env-file=.env bench/neutral-rewrite.mjs [days=14] [max=60] [think=0|1]
import process from 'node:process';
import pg from 'pg';
import {rewrittenTitle} from '../services/utils/neutral-titles.js';
import {newUsage} from '../services/utils/ollama.js';
import {writtenIn} from '../services/utils/language.js';

const [days = 14, max = 60, think = 0] = process.argv.slice(2).map(Number);
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rows} = await client.query(`SELECT items FROM briefings WHERE status = 'ready' AND created_at > now() - make_interval(days => $1)`, [days]);
await client.end();
const cards = [...new Map(rows.flatMap(row => row.items).filter(item => item.title && item.summary).map(item => [item.title, item])).values()]
    .sort((a, b) => a.title < b.title ? -1 : 1);
const text = (item) => [].concat(item.translation?.length ? item.translation : item.summary).join(' ');
// a mark of the medium: an exclamation mark, a word of judgment or of call, in the languages we read
const BAIT = /!|\b(incroyable|choc|bombe|scandale|honteu|historique|énorme|révélation|urgent|incredible|unbelievable|shocking|stunning|bombshell|devastating|massive|huge|disgrace|shameful|slams|destroys|humiliates|furious|outrage|nightmare|sensational|escándalo|increíble|bomba|scandalo|vergogna|incredibile|skandal|unglaublich|schock|sensacional|escândalo|inacreditável)/iu;
const marked = (item) => BAIT.test(item.titleTranslation ?? item.title);
// every Nth card: the same sample each run
const every = (list, count) => list.filter((_, i) => i % Math.max(1, Math.floor(list.length / count)) === 0).slice(0, count);
const picked = [...every(cards.filter(marked), Math.ceil(max / 2)), ...every(cards.filter(item => !marked(item)), Math.floor(max / 2))];

const usage = newUsage();
const counts = {proposed: 0, same: 0, unsafe: 0, failed: 0};
const problems = {};
for (const item of picked) {
    const title = item.titleTranslation ?? item.title;
    try {
        const answer = await rewrittenTitle(title, text(item), usage, {language: item.titleTranslation ? null : writtenIn(item.language), think: think === 1});
        const kind = answer.title ? 'proposed' : answer.reason;
        counts[kind]++;
        if (answer.problem) problems[answer.problem] = (problems[answer.problem] ?? 0) + 1;
        console.log(`\n[${kind}${marked(item) ? ', marked' : ''}${answer.problem ? `, ${answer.problem}` : ''}] ${title}${answer.title ? `\n   -> ${answer.title}` : answer.proposal ? `\n   x> ${answer.proposal}` : ''}`);
    } catch (err) {
        counts.failed++;
        console.log(`\n[failed] ${title}: ${err.message}`);
    }
}
console.log(`\n${picked.length} titles (think ${think}): ${JSON.stringify(counts)}, refused for ${JSON.stringify(problems)}, tokens ${JSON.stringify(usage)}`);
