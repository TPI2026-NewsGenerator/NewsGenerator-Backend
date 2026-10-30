// Stories mixing different matches ("Spain vs Croatia" with "Czechia vs England"), read with the functions
// of the database (matchup_of, different_matches in db/add_briefing.sql): the stories of the last days
// whose members name matches that are different ones
// node --env-file=.env bench/matchups.mjs [days=3]   -> bench/data/matchups/conflicts.json
import fs from 'node:fs';
import pg from 'pg';

const DAYS = Number(process.argv[2]) || 3;
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const rows = (await c.query(`
    SELECT a.id, a.id_story, a.medium, a.title, public.matchup_of(a.title) AS teams, public.title_names(a.title) AS names
    FROM articles a
    WHERE a.id_story IN (SELECT id_story FROM articles WHERE created_at > now() - $1 * interval '1 day' AND id_story IS NOT NULL
                         GROUP BY id_story HAVING count(*) >= 2)
      AND public.matchup_of(a.title) IS NOT NULL`, [DAYS])).rows;
const stories = Map.groupBy(rows, r => r.id_story);
const conflicts = [];
for (const [id, news] of stories) {
    // the groups of one match: a news joins the first group whose first news is not another match
    const groups = [];
    for (const n of news) {
        let joined = false;
        for (const g of groups) {
            const {rows: [{different}]} = await c.query('SELECT public.different_matches($1, $2, $3) AS different', [g[0].teams, g[0].names, n.title]);
            if (!different) { g.push(n); joined = true; break; }
        }
        if (!joined) groups.push([n]);
    }
    if (groups.length > 1) conflicts.push({story: id, groups: groups.map(g => ({count: g.length, sample: [...new Set(g.map(n => `${n.medium} | ${n.title}`))].slice(0, 3)}))});
}
await c.end();
console.log(`${stories.size} stories with news naming a match, ${conflicts.length} holding different matches`);
fs.mkdirSync('bench/data/matchups', {recursive: true});
fs.writeFileSync('bench/data/matchups/conflicts.json', JSON.stringify(conflicts, null, 1));
