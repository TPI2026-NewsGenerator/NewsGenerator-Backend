// a few batches tagged by one tagger, as the server does: node --env-file=.env bench/tag-try.mjs <url> <batches>
import {tagBatch} from '../services/tagging-service.js';
import {taggerDevice} from '../services/utils/tagger.js';
import {prisma} from '../config/db.js';
const url = process.argv[2], batches = Number(process.argv[3] ?? 3);
const device = await taggerDevice(url);
console.log(url, device);
for (let i = 0; i < batches; i++) {
    const t = Date.now();
    const n = await tagBatch(url, device);
    console.log(`${n} news in ${Date.now() - t} ms`);
}
console.table(await prisma.$queryRawUnsafe(`SELECT m.kind, m.name, m.key, m.lang, m.seen FROM mentions m ORDER BY m.id DESC LIMIT 25`));
await prisma.$disconnect();
process.exit(0);
