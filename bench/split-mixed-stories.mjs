// Stories grouped before the matchup rule (89c04ab) holding different matches, split: the match most of
// their news name keeps the story (its id, so the cards already shown stay excluded), each other match
// joins the story of its match when one exists (most of its news naming that match), else a story of its
// own. The news naming no match follow the match whose titles they resemble most (dense + sparse).
// The stories touched are marked grouped again, so assign_threads judges their thread again.
// node --env-file=.env bench/split-mixed-stories.mjs [days=3] [--apply]
//   dry run by default; --apply writes bench/data/matchups/split-backup-<time>.json first (news, story
//   before, story after), then moves the news in one transaction
import fs from 'node:fs';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const DAYS = Number(process.argv.find(a => /^\d+$/.test(a))) || 3;
// read by hand: one match written two ways (RDC / DR Congo, Commanders / Washington, FSU / Florida
// State, WVU / West Virginia, Silva vs Wang / Silva vs Cong: Cong Wang, Notre Dame vs North Carolina /
// vs UNC, "Offensive Vision vs. Minnesota" / "Football vs Minnesota") or one fact (the schedule of the
// cricket World Cup 2027)
// the 10 days run: Socceroos / Australia, USMNT / USA, "Texans' 3 Biggest Matchups vs. Cowboys"; #8312
// (Austria vs Kosovo held with "Austria Wien" by the Wien of Austria Wien) moved by hand
const SAME_MATCH = new Set([90216, 51440, 35096, 46008, 21220, 37152, 30091, 35349, 32391, 1796, 18694, 36212, 8312]);
// destinations read by hand on the 10 days run, by story and match title (null: a story of its own):
// the first 3 letters met other teams (Texans vs Colts with Colorado vs Texas Tech, "Andrey" of Rublev)
const BY_HAND = new Map([
    ['8115|Texans vs. Colts', null], ['11606|India vs Japan', null], ['11606|India vs Bangladesh', null],
    ['6711|Alexandre Muller', null], ['13390|Netball World Cup', null], ['15254|Austria vs Kosovo', null],
    ['12070|Daniil Medvedev vs Andrey Rublev', 20308],
]);
const MAYBE_MATCH = "'[^[:alnum:]](vs|v|versus)[^[:alnum:]]'";

const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const different = async (a, title) =>
    (await c.query('SELECT public.different_matches($1, $2, $3) AS d', [a.teams, a.names, title])).rows[0].d;

// the stories of the last DAYS days holding news naming a match
const rows = (await c.query(`
    SELECT a.id, a.id_story, a.lang, a.title, COALESCE(a.published_at, a.created_at) AS at,
           public.matchup_of(a.title) AS teams, public.title_names(a.title) AS names
    FROM articles a
    WHERE a.id_story IN (SELECT id_story FROM articles WHERE created_at > now() - $1 * interval '1 day' AND id_story IS NOT NULL
                         GROUP BY id_story HAVING count(*) >= 2)
      AND a.title ~* ${MAYBE_MATCH} AND public.matchup_of(a.title) IS NOT NULL
    ORDER BY a.id_story, a.id`, [DAYS])).rows;

// first pass: the matches of each mixed story, and the one keeping it
const mixed = new Map();
for (const [story, news] of Map.groupBy(rows, r => r.id_story)) {
    if (SAME_MATCH.has(story)) continue;
    // a news joins the first group whose first news names the same match
    const groups = [];
    for (const n of news) {
        let group = null;
        for (const g of groups) if (!(await different(g[0], n.title))) { group = g; break; }
        if (group) group.push(n); else groups.push([n]);
    }
    if (groups.length < 2) continue;

    // the news naming no match: with the group whose titles they resemble most on average
    const keys = groups.flatMap((g, k) => g.map(n => ({k, id: n.id})));
    const closest = (await c.query(`
        SELECT DISTINCT ON (x.id) x.id, g.k
        FROM articles x
        JOIN jsonb_to_recordset($2::jsonb) AS g(k int, id int) ON true
        JOIN articles m ON m.id = g.id
        WHERE x.id_story = $1 AND x.id <> ALL($3)
        GROUP BY x.id, g.k
        ORDER BY x.id, avg(-(x.title_dense <#> m.title_dense) - (x.title_sparse <#> m.title_sparse)) DESC, g.k`,
        [story, JSON.stringify(keys), keys.map(key => key.id)])).rows;
    const followers = groups.map((_, k) => closest.filter(r => r.k === k).map(r => r.id));
    // the match keeping the story: the one with the most news, its followers counted
    const order = groups.map((_, k) => k).sort((x, y) => (groups[y].length + followers[y].length) - (groups[x].length + followers[x].length));
    mixed.set(story, {groups, followers, order});
}

// second pass: where each other match goes, the story of its match around then when one exists (titles
// holding both teams, most of them naming this match), not a mixed story keeping another match
const plan = [];
for (const [story, {groups, followers, order}] of mixed) {
    for (const k of order.slice(1)) {
        const g = groups[k], first = g[0];
        const from = new Date(Math.min(...g.map(n => n.at)) - 4 * 86400e3), to = new Date(Math.max(...g.map(n => n.at)) + 4 * 86400e3);
        const candidates = (await c.query(`
            SELECT a.id_story, array_agg(a.title) AS titles
            FROM articles a
            WHERE a.lang = $1 AND a.id_story IS NOT NULL AND a.id_story <> $2
              AND (COALESCE(a.published_at, a.created_at) BETWEEN $3 AND $4 OR a.created_at BETWEEN $3 AND $4)
              AND a.title ~* ${MAYBE_MATCH}
              AND a.title ~* ('[[:<:]]' || $5) AND a.title ~* ('[[:<:]]' || $6)
            GROUP BY a.id_story`, [first.lang, story, from, to, first.teams[0], first.teams[1]])).rows;
        let target = null, best = 0;
        for (const cand of candidates) {
            // a mixed story: only the match it keeps counts, its other matches leave it
            const other = mixed.get(cand.id_story);
            if (other) {
                const keeps = other.groups[other.order[0]];
                if (!(await different(first, keeps[0].title)) && keeps.length > best) { target = cand.id_story; best = keeps.length; }
                continue;
            }
            let same = 0, apart = 0;
            for (const title of cand.titles) {
                const d = await different(first, title);
                if (d === false) same++; else if (d === true) apart++;
            }
            // two titles at least: one title meeting by chance sent "Bruins vs Wild" to "Wilt's Career vs..."
            if (same >= 2 && same > apart && same > best) { target = cand.id_story; best = same; }
        }
        for (const [key, to] of BY_HAND) if (key === `${story}|${first.title.slice(0, key.length - String(story).length - 1)}`) target = to;
        plan.push({story, lang: first.lang, keeps: groups[order[0]][0].title, match: first.title, teams: first.teams, names: first.names,
                   target, news: [...g.map(n => n.id), ...followers[k]], at: Math.max(...g.map(n => n.at))});
    }
}

const moved = plan.reduce((sum, p) => sum + p.news.length, 0);
console.log(`${new Set(plan.map(p => p.story)).size} stories split, ${plan.length} matches moved (${moved} news): ` +
            `${plan.filter(p => p.target).length} into the story of their match, ${plan.filter(p => !p.target).length} into a story of their own`);
for (const p of plan) console.log(`  #${p.story} keeps "${p.keeps.slice(0, 50)}" | ${p.news.length} news "${p.match.slice(0, 50)}" -> ${p.target ? '#' + p.target : 'new story'}`);

if (APPLY && plan.length) {
    const before = (await c.query('SELECT id, id_story FROM articles WHERE id = ANY($1)', [plan.flatMap(p => p.news)])).rows;
    const backup = `bench/data/matchups/split-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    fs.writeFileSync(backup, JSON.stringify({plan, before}, null, 1));
    await c.query('BEGIN');
    try {
        for (const p of plan) {
            // one new story for one match left without a story by several mixed stories
            let twin = null;
            for (const q of plan) {
                if (q === p) break;
                // the same match, not only "not shown different": both teams of each in the other
                // (else "Penn State MSOC vs. Ohio State" joined "Penn State vs. Wisconsin")
                const same = p.teams.every(t => q.names.some(n => n.startsWith(t))) && q.teams.every(t => p.names.some(n => n.startsWith(t)));
                if (!q.target && q.to && q.lang === p.lang && same) { twin = q; break; }
            }
            p.to = p.target ?? twin?.to ?? (await c.query(
                'INSERT INTO stories (lang, updated_at, grouped_at) VALUES ($1, $2, now()) RETURNING id', [p.lang, new Date(p.at)])).rows[0].id;
            await c.query('UPDATE articles SET id_story = $1 WHERE id = ANY($2) AND id_story = $3', [p.to, p.news, p.story]);
        }
        // the stories touched: dated from their news, grouped again (their thread judged again)
        const touched = [...new Set(plan.flatMap(p => [p.story, p.to]))];
        await c.query(`
            UPDATE stories s SET updated_at = COALESCE(m.at, s.updated_at), grouped_at = now()
            FROM (SELECT x.id, (SELECT max(COALESCE(a.published_at, a.created_at)) FROM articles a WHERE a.id_story = x.id) AS at
                  FROM unnest($1::int[]) AS x(id)) m
            WHERE s.id = m.id`, [touched]);
        await c.query('COMMIT');
        fs.writeFileSync(backup, JSON.stringify({plan, before}, null, 1));
        console.log(`applied; backup in ${backup}`);
    } catch (err) {
        await c.query('ROLLBACK');
        throw err;
    }
}
await c.end();
