// The second opinion on the 10 alerts of the replay of the cyberattack affair (a wave that hits one country after another),
// read by hand: G (a new fact that changes the scale or the stakes: first spread to a country, the hackers' identity, a
// company's forecast), B (one more country or company of the same wave, or a detail). Each is asked with the ones before it
//
//  node bench/affairs/confirm-bench-cyber.mjs <replay.json>
import 'dotenv/config';
import process from 'node:process';
import {readFileSync} from 'node:fs';
import {confirmEvents, confirmPrompt} from '../../services/utils/affair-judge.js';
import {newUsage} from '../../services/utils/ollama.js';

const {rings} = JSON.parse(readFileSync(process.argv[2], 'utf8'));
// Italy, Delhaize Luxembourg, Germany, a Greek butcher, minors among the hackers, UK meat firms, Coop and Ikea, Norway, Portugal, Ahold Delhaize forecast
const LABELS = ['G', 'B', 'G', 'B', 'G', 'G', 'B', 'B', 'B', 'G'];
const file = {
    title: 'Cyberattaques contre les supermarchés français et menaces sur la sécurité alimentaire',
    about: 'A wave of cyberattacks that hacked the refrigeration systems and the information systems of supermarkets, first in France then in other European countries, threatening food safety.',
    not: 'Other cyberattacks unrelated to food retail, and ordinary news of the supermarket chains.',
};
const PATTERN = 'The same kind of fact as ones the reader was already told, happening to one more country, company or person (one more shop hit, one more country affected), is NOT new unless it changes the nature or the scale of the affair (the first country beyond the first ones, the identity of the attackers, an arrest, a claim, an official measure, a financial figure).\n';
const withPattern = (f, known, events) => confirmPrompt(f, known, events).replace('In doubt: false.', `${PATTERN}In doubt: false.`);

for (const [name, options] of [['current prompt', {}], ['+ pattern clause', {prompt: withPattern}]]) {
    const usage = newUsage();
    const rung = [];
    for (let i = 0; i < rings.length; i++) {
        const [yes] = await confirmEvents(file, rings.slice(0, i), [rings[i]], usage, options).catch(() => [null]);
        rung.push(yes);
    }
    const count = (label) => rung.filter((one, i) => LABELS[i] === label && one === true).length;
    console.log(`${name}: rings ${rung.filter(Boolean).length}/${rung.length}  G kept ${count('G')}/5  B kept ${count('B')}/5   ${rung.map((one, i) => `${LABELS[i]}${one ? '+' : '-'}`).join(' ')}   tokens ${JSON.stringify(usage)}`);
}
