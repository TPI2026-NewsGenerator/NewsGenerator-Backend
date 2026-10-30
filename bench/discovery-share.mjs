// The feeds found for the profiles (user_feeds origin 'profile', every user): of their last 30 news
// embedded, how many the judge of discovery puts on the profile (cosine of the title vector >= 0.45
// with one of the user's interests). Which a rule "at least N" or "at least S of them" would refuse
import {prisma} from '../config/db.js';

const rows = await prisma.$queryRawUnsafe(`
    SELECT uf.id_user, uf.site, uf.url, uf.created_at::date AS added, count(*)::int AS judged,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM profile_interests i WHERE i.id_user = uf.id_user
               AND i.dense IS NOT NULL AND -(last.title_dense <#> i.dense) >= 0.45))::int AS on_subject
    FROM user_feeds uf
    JOIN feeds f ON f.url = uf.url
    CROSS JOIN LATERAL (SELECT a.title_dense FROM articles a WHERE a.id_feed = f.id AND a.title_dense IS NOT NULL
                        ORDER BY a.created_at DESC LIMIT 30) last
    WHERE uf.origin = 'profile'
    GROUP BY uf.id_user, uf.site, uf.url, uf.created_at
    ORDER BY count(*) FILTER (WHERE EXISTS (SELECT 1 FROM profile_interests i WHERE i.id_user = uf.id_user AND i.dense IS NOT NULL AND -(last.title_dense <#> i.dense) >= 0.45))::real / count(*)`);
for (const row of rows) {
    const share = row.on_subject / row.judged;
    const flag = row.on_subject >= 2 && (row.on_subject < 3 || share < 0.10) ? (row.on_subject < 3 ? 'N<3 ' : '    ') + (share < 0.10 ? 'S<10%' : '     ') : '';
    console.log(`${String(row.id_user).padStart(4)} ${String(row.on_subject).padStart(2)}/${String(row.judged).padEnd(2)} ${(share * 100).toFixed(0).padStart(3)}% ${flag.padEnd(10)} ${row.site.padEnd(28)} ${row.url.slice(0, 75)}`);
}
console.log(`${rows.length} feeds`);
await prisma.$disconnect();
