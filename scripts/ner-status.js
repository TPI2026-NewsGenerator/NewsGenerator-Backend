//
//  Author: Fabian Rostello
//  Date: 13.10.2026
//  File: ner-status.js
//  Description: Where the tagging stands (see tagging-service.js): the taggers that answer, the news of
//               the retention with their names, those still waiting, the pace of the last minutes and
//               the time left at that pace, the names looked for in Wikidata
//
//  node scripts/ner-status.js       (pnpm run ner:status)
//

import 'dotenv/config';
import {prisma} from '../config/db.js';
import {LINK_LEAST, TAG_DAYS} from '../services/tagging-service.js';
import {taggerDevice, taggerUrls} from '../services/utils/tagger.js';

const PACE_MINUTES = 15;    // the pace is measured on the news tagged in these last minutes
const DEVICES = {cuda: 'graphics card', cpu: 'processor'};

const urls = taggerUrls();
const devices = await Promise.all(urls.map(taggerDevice));

const [status] = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS news,
           count(*) FILTER (WHERE entities_at IS NULL)::int AS pending,
           count(*) FILTER (WHERE entities_at > now() - make_interval(mins => $2::int))::int AS recent,
           max(entities_at) AS last
    FROM articles
    WHERE created_at >= now() - make_interval(days => $1::int)`,
    TAG_DAYS, PACE_MINUTES);

const [names] = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS names,
           count(*) FILTER (WHERE seen >= $1)::int AS often,
           count(*) FILTER (WHERE linked_at IS NOT NULL)::int AS looked,
           count(*) FILTER (WHERE qid IS NOT NULL)::int AS linked,
           count(*) FILTER (WHERE linked_at IS NULL AND seen >= $1)::int AS waiting
    FROM mentions`, LINK_LEAST);

const tagged = status.news - status.pending;
const percent = status.news > 0 ? Math.round(100 * tagged / status.news) : 100;
const perMinute = status.recent / PACE_MINUTES;
const left = perMinute > 0 ? Math.round(status.pending / perMinute) : null;
const time = (minutes) => minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}` : `${minutes} min`;

console.log('Taggers:');
if (urls.length === 0) console.log('  none: NER_URL is not set in this .env, the news are not tagged from here');
urls.forEach((url, i) => console.log(`  ${url}  ${devices[i] ? `answers (${DEVICES[devices[i]] ?? devices[i]})` : 'does not answer'}`));
console.log(`News of the last ${TAG_DAYS} days: ${status.news}`);
console.log(`  with their names: ${tagged} (${percent}%)`);
console.log(`  waiting:          ${status.pending}`);
console.log(`  last tagged:      ${status.last ? status.last.toLocaleString('fr-CH') : 'never'}`);
console.log(`  pace:             ${Math.round(perMinute)} news/min over the last ${PACE_MINUTES} min`);
console.log(`  time left:        ${status.pending === 0 ? 'none' : left === null ? `unknown, nothing tagged in the last ${PACE_MINUTES} min` : `about ${time(left)} at this pace`}`);
console.log(`Names: ${names.names}, ${names.often} named by ${LINK_LEAST} news or more`);
console.log(`  looked for in Wikidata: ${names.looked}, linked to an item: ${names.linked}, waiting: ${names.waiting}`);

await prisma.$disconnect();
