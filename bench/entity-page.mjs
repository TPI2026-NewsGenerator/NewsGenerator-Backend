// the page of an item as the API answers it, timed: node --env-file=.env bench/entity-page.mjs <qid> [profile] [hours]
import {EntityService} from '../services/entity-service.js';
import {prisma} from '../config/db.js';
const [qid = 'Q35572', profile = '7', hours = '48'] = process.argv.slice(2);
const t = Date.now();
const page = await EntityService.page(Number(profile), qid, Number(hours));
console.log(`${page.entity.label}: ${page.count} stories in ${Date.now() - t} ms; names ${JSON.stringify(page.entity.nameCounts)}`);
console.log(page.links.slice(0, 5).map(link => `${link.label} ${link.count}`).join(', '));
await prisma.$disconnect();
process.exit(0);
