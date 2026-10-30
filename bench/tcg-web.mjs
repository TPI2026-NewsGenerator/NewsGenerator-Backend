import {SourceService} from '../services/source-service.js';
const t = Date.now();
const r = await SourceService.suggest({keywords: ['cartes tcg suisse'], userId: 4, language: 'fr', timeframe: {start: new Date(Date.now() - 30 * 864e5).toISOString()}});
console.log(`${((Date.now() - t) / 1000).toFixed(0)}s, news ${r.news.length}, missing media ${r.missing}, tried ${r.tried}`);
for (const n of r.news.slice(0, 12)) console.log(`  ${n.site} | ${n.publishedAt?.slice(0, 10)} | ${n.title.slice(0, 110)}`);
for (const s of r.sources) console.log(`  SOURCE ${s.site} ${s.feed} e.g. ${s.sample?.slice(0, 80)}`);
process.exit(0);
