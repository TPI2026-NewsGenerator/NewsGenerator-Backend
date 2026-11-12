//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: fifa-discover.js
//  Description: Looks in the news of the last days for the persons named as candidates for the presidency of FIFA, has two models judge each of them, and says who the map
//               would add by itself (the server does it once a day). Nothing is added without --apply
//
//  node --env-file=.env scripts/fifa-discover.js [--days=14] [--apply]
//

import process from 'node:process';
import {prisma} from '../config/db.js';
import {FifaService} from '../services/fifa-service.js';

const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const apply = process.argv.includes('--apply');

try {
    const answer = await FifaService.discover({days: Number(option('days', 14)), apply});
    if (answer.skipped) {
        console.log('A search is already running.');
    } else {
        console.log(`${answer.news} news hold FIFA, a president word and a candidacy word; ${answer.persons} persons are named in them (the ones on the map or taken off are left out)`);
        for (const one of answer.judged) {
            console.log(`  ${one.add ? (apply ? 'ADDED ' : 'WOULD ADD ') : 'no     '} ${one.name} (${one.qid}): ${one.articles} articles, ${one.media} media${one.status ? `, ${one.status}` : ''}${one.why ? ` [${one.why}]` : ''}${one.quote ? ` | ${one.quote.slice(0, 140)}` : ''}`);
        }
        if (answer.full) console.log('The map is full: none is added until a candidate is marked withdrawn.');
        console.log(`${answer.tokens.calls} calls, ${answer.tokens.input} tokens in, ${answer.tokens.output} out${apply ? '' : ' (nothing added: add --apply)'}`);
    }
} finally {
    await prisma.$disconnect();
}
