// The feeds found for the profiles that prune removes, judged on the title alone (title_dense, as now) or
// on the title and the start of the description (text_dense, the text the discovery judged them on).
// Read only, nothing removed
//   node --env-file=.env bench/prune-text.mjs
import {prisma} from '../config/db.js';
import {JUDGE_THRESHOLD, RELEVANCE_DAYS} from '../services/discovery-service.js';

const since = new Date(Date.now() - RELEVANCE_DAYS * 24 * 3600e3);
const rows = await prisma.$queryRawUnsafe(`
    SELECT uf.id_user, uf.site, uf.created_at, count(a.id)::int AS news,
           count(a.id) FILTER (WHERE EXISTS (SELECT 1 FROM profile_interests i WHERE i.id_user = uf.id_user AND i.dense IS NOT NULL
                 AND -(a.title_dense <#> i.dense) >= $2::real))::int AS by_title,
           count(a.id) FILTER (WHERE EXISTS (SELECT 1 FROM profile_interests i WHERE i.id_user = uf.id_user AND i.dense IS NOT NULL
                 AND -(a.text_dense <#> i.dense) >= $2::real))::int AS by_text
    FROM user_feeds uf
    LEFT JOIN feeds f ON f.url = uf.url
    LEFT JOIN articles a ON a.id_feed = f.id AND a.embedded_at IS NOT NULL AND a.created_at >= $1::timestamptz
    WHERE uf.origin = 'profile'
    GROUP BY uf.id`, since, JUDGE_THRESHOLD);
const old = (row) => Date.now() - new Date(row.created_at) >= RELEVANCE_DAYS * 864e5 || row.news >= 30;
const removed = (key) => rows.filter(row => row[key] === 0 && old(row));
const title = removed('by_title'), text = removed('by_text');
console.log(`${rows.length} feeds found for ${new Set(rows.map(r => r.id_user)).size} readers`);
console.log(`removed on the title: ${title.length}, on title + description: ${text.length}`);
console.log(`share of the news on the profile: title ${(rows.reduce((s, r) => s + r.by_title, 0) / rows.reduce((s, r) => s + r.news, 0) * 100).toFixed(1)} %, text ${(rows.reduce((s, r) => s + r.by_text, 0) / rows.reduce((s, r) => s + r.news, 0) * 100).toFixed(1)} %`);
console.log('\nremoved on the title, kept on title + description:');
title.filter(r => r.by_text > 0).forEach(r => console.log(`  user ${r.id_user} ${r.site.padEnd(28)} ${r.news} news, ${r.by_text} on the profile by text`));
console.log('\nremoved either way:');
text.forEach(r => console.log(`  user ${r.id_user} ${r.site.padEnd(28)} ${r.news} news`));
process.exit(0);
