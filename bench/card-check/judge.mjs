// The AI checking a link on its card: given the titles of the card, the name and the item it is linked to,
// does the name mean this item? yes | no | unsure, asked for each linked name of cards.json. Writes
// verdicts.json. node --env-file=.env bench/card-check/judge.mjs
import fs from 'node:fs';
import {ollamaJson, newUsage} from '../../services/utils/ollama.js';
import {checkPrompt as prompt, countryName} from '../../services/utils/name-check.js';

export const checkPrompt = (e) => `A name in the news of one card: "${e.name}" (${e.kind}).

Titles of the news of the card:
${e.titles.map(title => `- ${title}`).join('\n')}

Its link to Wikidata: ${e.label}: ${e.description || '(no description)'} (${e.links} Wikipedias${e.itemCountry ? `, country ${e.itemCountry}` : ''}).

Is the "${e.name}" of this card this item? "yes" when the titles fit what the item says (their field, their role,
their country). "no" when the card means another thing (another person, a place, a work, a body of another
country, a common word). "unsure" when the titles say too little to tell.
Answer in JSON only: {"same": "yes"}`;

if (import.meta.url === new URL(process.argv[1], 'file:///').href || process.argv[1]?.endsWith('judge.mjs')) {
    const entries = JSON.parse(fs.readFileSync(new URL('./cards.json', import.meta.url), 'utf8'));
    const usage = newUsage();
    const verdicts = new Array(entries.length);
    let next = 0;
    const worker = async () => {
        for (;;) {
            const i = next++;
            if (i >= entries.length) return;
            const e = entries[i];
            // WITH_SITES=1: the countries of the card's sites in the prompt, as name-check.js
            const countries = process.env.WITH_SITES ? Object.entries(e.sites).sort((a, b) => b[1] - a[1]).map(([code, news]) => `${countryName(code)} (${news})`).join(', ') : '';
            const rich = process.env.WITH_RICH ? {topic: e.topic, others: e.others} : {};
            const answer = await ollamaJson(process.env.WITH_SITES ? prompt({...e, ...rich, countries, country: e.itemCountry}) : checkPrompt(e), usage);
            verdicts[i] = ['yes', 'no', 'unsure'].includes(answer?.same) ? answer.same : 'error';
        }
    };
    await Promise.all([worker(), worker(), worker()]);
    fs.writeFileSync(new URL(process.env.WITH_RICH ? './verdicts-rich.json' : process.env.WITH_SITES ? './verdicts-sites.json' : './verdicts.json', import.meta.url), JSON.stringify(verdicts));
    console.log(JSON.stringify(usage), verdicts.reduce((a, v) => (a[v] = (a[v] ?? 0) + 1, a), {}));
}
