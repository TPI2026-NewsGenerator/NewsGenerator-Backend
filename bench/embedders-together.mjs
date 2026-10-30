// Several embedders at the same time (services/utils/embedder.js), measured on real texts: the titles
// and descriptions of 64 recent news, as the ingestion sends them. MODE=local: the embedder of this
// machine alone; MODE=both: it with the second one of EMBEDDER_URL (the server). Reads only
import process from 'node:process';
import {prisma} from '../config/db.js';
import {richText} from '../services/ingest-service.js';

const LOCAL = 'http://127.0.0.1:8020';
const listed = (process.env.EMBEDDER_URL ?? '').split(',').map(url => url.trim()).filter(Boolean);
process.env.EMBEDDER_URL = process.env.MODE === 'both' ? `${listed[1]},${LOCAL}` : LOCAL;
const {embed} = await import('../services/utils/embedder.js');

const news = await prisma.$queryRawUnsafe(`SELECT title, description FROM articles WHERE created_at >= now() - interval '1 hour' ORDER BY id DESC LIMIT 64`);
const texts = [...new Set(news.flatMap(row => [row.title, richText(row.title, row.description)]))];

// who got what: the requests of the embedders counted
const realFetch = globalThis.fetch;
const counted = new Map();
globalThis.fetch = (url, options) => {
    if (String(url).endsWith('/embed')) {
        const who = String(url).startsWith(LOCAL) ? 'this machine' : 'server';
        counted.set(who, (counted.get(who) ?? 0) + JSON.parse(options.body).texts.length);
    }
    return realFetch(url, options);
};

await embed(['warm up']);
counted.clear();
const started = Date.now();
const vectors = await embed(texts);
const seconds = (Date.now() - started) / 1000;
console.log(`${process.env.MODE ?? 'local'}: ${vectors.length} texts in ${seconds.toFixed(1)} s (${(vectors.length / seconds).toFixed(1)} a second), ${JSON.stringify(Object.fromEntries(counted))}`);
await prisma.$disconnect();
