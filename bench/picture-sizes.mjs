// Read only: the size of the pictures the e-mail picker offers (storyPictures of each card of the last
// ready briefings), read from the first bytes of each image as a mail client would load it.
// node --env-file=.env bench/picture-sizes.mjs [briefings=6]
import {writeFileSync} from 'node:fs';
import {prisma} from '../config/db.js';
import {BriefingModel} from '../models/briefing-model.js';
import {storyPictures} from '../services/utils/mail-pictures.js';
import {imageSize} from './image-size.mjs';

const count = Number(process.argv[2] ?? 6);
const rows = await prisma.$queryRawUnsafe(`SELECT id, items FROM briefings WHERE status = 'ready' ORDER BY created_at DESC LIMIT $1`, count);
const offered = [];
for (const row of rows) {
    for (const item of row.items ?? []) {
        const links = [item.lead, ...(item.articles ?? [])].filter(Boolean).map(article => article.url);
        const pictures = storyPictures(item, await BriefingModel.articlePictures(item.storyId, links));
        pictures.forEach((picture, index) => offered.push({...picture, own: index === 0 && picture.url === item.thumbnail, story: item.storyId}));
    }
}
const unique = [...new Map(offered.map(picture => [picture.url, picture])).values()];
console.log(`${rows.length} briefings, ${offered.length} pictures offered, ${unique.length} different`);

const results = [];
let next = 0;
await Promise.all(Array.from({length: 12}, async () => {
    while (next < unique.length) {
        const picture = unique[next++];
        results.push({...picture, ...await imageSize(picture.url)});
    }
}));

const bands = [[0, 'failed'], [1, '< 300'], [300, '300-559'], [560, '560-799'], [800, '800-1199'], [1200, '>= 1200']];
const band = (result) => result.width === undefined ? 'failed' : bands.filter(([min]) => min > 0 && result.width >= min).at(-1)?.[1] ?? '< 300';
const tally = (list) => Object.fromEntries(bands.map(([, name]) => [name, list.filter(result => band(result) === name).length]));
console.log('all     ', tally(results));
console.log('own     ', tally(results.filter(result => result.own)));
console.log('others  ', tally(results.filter(result => !result.own)));
writeFileSync(new URL('./data/picture-sizes.json', import.meta.url), JSON.stringify(results, null, 1));
for (const result of results.filter(result => result.width !== undefined && result.width < 560).slice(0, 40)) {
    console.log(`${result.width}x${result.height} ${result.bytes ?? '?'}B ${result.source} ${result.url.slice(0, 140)}`);
}
console.log('--- failed');
for (const result of results.filter(result => result.width === undefined).slice(0, 15)) console.log(`${result.error} ${result.url.slice(0, 120)}`);
await prisma.$disconnect();
