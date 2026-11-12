//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: discover.mjs
//  Description: Measure of the discovery of candidates of the FIFA presidency in the news (read only, no write): which persons the news of the last days name as candidate
//               for the presidency of FIFA, with the sentences, the media, and (with --judge) what the AI says of each sentence. What the service takes is this module's
//               rules (services/utils/fifa-discovery.js)
//
//  node --env-file=.env bench/fifa/discover.mjs [--days=30] [--judge] [--top=25]
//

import process from 'node:process';
import {prisma} from '../../config/db.js';
import {FifaModel} from '../../models/fifa-model.js';
import {candidateSentences, DISCOVERY_REGEX, personsIn} from '../../services/utils/fifa-discovery.js';

const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const days = Number(option('days', 30));
const top = Number(option('top', 25));
const since = new Date(Date.now() - days * 864e5);

try {
    const started = Date.now();
    const news = await FifaModel.discoveryNews({since});
    console.log(`${news.length} news of the last ${days} days match the three words (FIFA, a president word, a candidacy word), ${Math.round((Date.now() - started) / 1000)} s`);
    const persons = await FifaModel.personsOfArticles(news.map(item => item.id));
    console.log(`${persons.length} tagged persons with an item of Wikidata in them`);
    const byPerson = new Map();
    let sentences = 0;
    for (const item of news) {
        const names = persons.filter(row => row.id === item.id);
        for (const sentence of candidateSentences(item.text ?? `${item.title} | ${item.description ?? ''}`)) {
            sentences++;
            for (const person of personsIn(sentence, names)) {
                const kept = byPerson.get(person.qid) ?? {qid: person.qid, name: person.name, media: new Set(), articles: new Set(), samples: []};
                kept.media.add(item.medium);
                kept.articles.add(item.id);
                if (kept.samples.length < 3) kept.samples.push(`${item.medium}: ${sentence.slice(0, 230)}`);
                byPerson.set(person.qid, kept);
            }
        }
    }
    console.log(`${sentences} candidacy sentences, ${byPerson.size} persons named in them\n`);
    const ranked = [...byPerson.values()].sort((a, b) => b.media.size - a.media.size || b.articles.size - a.articles.size).slice(0, top);
    for (const one of ranked) {
        console.log(`${one.name} (${one.qid}): ${one.articles.size} articles, ${one.media.size} media`);
        for (const sample of one.samples) console.log(`    ${sample}`);
    }
    if (process.argv.includes('--judge')) console.log('\n(--judge: see the judge step in the service tests; this bench only counts)');
    console.log(`\nregex: ${DISCOVERY_REGEX.fifa} / ${DISCOVERY_REGEX.president} / ${DISCOVERY_REGEX.candidacy}`.slice(0, 400));
} finally {
    await prisma.$disconnect();
}
