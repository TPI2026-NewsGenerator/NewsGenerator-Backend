// Exploration read-only: the Infantino corpus of the 30 days, by text, and how much the tagger read of it
import {prisma} from '../../config/db.js';
let t = Date.now();
const lap = (label) => { console.log(`-- ${label}: ${((Date.now() - t) / 1000).toFixed(1)} s`); t = Date.now(); };

const fifa = await prisma.$queryRawUnsafe(`SELECT name, kind, qid, seen FROM mentions WHERE key IN ('fifa','federation internationale de football association') AND qid IS NOT NULL ORDER BY seen DESC LIMIT 5`);
console.table(fifa); lap('fifa qid');

const [c] = await prisma.$queryRawUnsafe(`
  SELECT count(*)::int AS news,
         count(*) FILTER (WHERE entities_at IS NOT NULL)::int AS tagged,
         count(*) FILTER (WHERE id_story IS NOT NULL)::int AS in_story,
         count(DISTINCT medium_of(link))::int AS media,
         min(COALESCE(published_at, created_at)) AS oldest, max(COALESCE(published_at, created_at)) AS newest
  FROM articles
  WHERE search_text ~* 'infantino' AND COALESCE(published_at, created_at) >= now() - interval '30 days'`);
console.log(c); lap('infantino corpus');

const langs = await prisma.$queryRawUnsafe(`
  SELECT lang, count(*)::int AS news FROM articles
  WHERE search_text ~* 'infantino' AND COALESCE(published_at, created_at) >= now() - interval '30 days'
  GROUP BY lang ORDER BY news DESC LIMIT 15`);
console.table(langs); lap('languages');
await prisma.$disconnect();
