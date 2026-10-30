// what the Google News path finds for a subject: node bench/suggest-probe.mjs <lang> <days> "keywords"
import 'dotenv/config';
import {SourceService} from '../services/source-service.js';
const [lang, days, keywords] = process.argv.slice(2);
const t = Date.now();
const r = await SourceService.suggest({keywords: [keywords], language: lang, userId: 129, timeframe: {start: new Date(Date.now() - days * 864e5)}});
console.log(`${keywords}: ${r.news.length} news, ${r.missing} media missing, ${r.tried} tried, ${r.sources.length} with a feed, ${Math.round((Date.now() - t) / 1000)} s`);
for (const s of r.sources) console.log(`   ${s.news} news  ${s.site}  ${s.feed}  | ${s.sample ?? ''}`);
for (const n of r.news.slice(0, 8)) console.log(`   - ${n.title?.slice(0, 90)} [${n.site}]`);
process.exit(0);
