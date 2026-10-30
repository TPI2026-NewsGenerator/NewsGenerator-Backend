// The news naming another match than most of their story, in stories given by hand (a title already there
// before split-mixed-stories.mjs, so it did not count as a group of its own): each goes to the story of its
// match around then when one exists (2 titles at least naming it, more than another match), else a story
// of its own
// node --env-file=.env bench/split-fix-strays.mjs <story>... [--apply]
import fs from 'node:fs';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const STORIES = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number);
const MAYBE_MATCH = "'[^[:alnum:]](vs|v|versus)[^[:alnum:]]'";

const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const different = async (a, title) =>
    (await c.query('SELECT public.different_matches($1, $2, $3) AS d', [a.teams, a.names, title])).rows[0].d;

const moves = [];
for (const story of STORIES) {
    const news = (await c.query(`
        SELECT a.id, a.lang, a.title, COALESCE(a.published_at, a.created_at) AS at,
               public.matchup_of(a.title) AS teams, public.title_names(a.title) AS names
        FROM articles a WHERE a.id_story = $1 AND public.matchup_of(a.title) IS NOT NULL ORDER BY a.id`, [story])).rows;
    // the news another match than most of the others
    for (const n of news) {
        let apart = 0, same = 0;
        for (const m of news) if (m !== n) (await different(n, m.title)) ? apart++ : same++;
        if (apart <= same) continue;
        const from = new Date(+n.at - 4 * 86400e3), to = new Date(+n.at + 4 * 86400e3);
        const candidates = (await c.query(`
            SELECT a.id_story, array_agg(a.title) AS titles
            FROM articles a
            WHERE a.lang = $1 AND a.id_story IS NOT NULL AND a.id_story <> $2
              AND (COALESCE(a.published_at, a.created_at) BETWEEN $3 AND $4 OR a.created_at BETWEEN $3 AND $4)
              AND a.title ~* ${MAYBE_MATCH}
              AND a.title ~* ('[[:<:]]' || $5) AND a.title ~* ('[[:<:]]' || $6)
            GROUP BY a.id_story`, [n.lang, story, from, to, n.teams[0], n.teams[1]])).rows;
        let target = null, best = 0;
        for (const cand of candidates) {
            let s = 0, a = 0;
            for (const title of cand.titles) {
                const d = await different(n, title);
                if (d === false) s++; else if (d === true) a++;
            }
            if (s >= 2 && s > a && s > best) { target = cand.id_story; best = s; }
        }
        moves.push({story, id: n.id, lang: n.lang, title: n.title, at: +n.at, target});
        console.log(`#${story}: "${n.title.slice(0, 70)}" -> ${target ? '#' + target : 'new story'}`);
    }
}

if (APPLY && moves.length) {
    const backup = `bench/data/matchups/split-strays-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    fs.writeFileSync(backup, JSON.stringify({moves}, null, 1));
    await c.query('BEGIN');
    try {
        for (const m of moves) {
            m.to = m.target ?? (await c.query('INSERT INTO stories (lang, updated_at, grouped_at) VALUES ($1, $2, now()) RETURNING id', [m.lang, new Date(m.at)])).rows[0].id;
            await c.query('UPDATE articles SET id_story = $1 WHERE id = $2 AND id_story = $3', [m.to, m.id, m.story]);
        }
        const touched = [...new Set(moves.flatMap(m => [m.story, m.to]))];
        await c.query(`
            UPDATE stories s SET updated_at = COALESCE(x.at, s.updated_at), grouped_at = now()
            FROM (SELECT u.id, (SELECT max(COALESCE(a.published_at, a.created_at)) FROM articles a WHERE a.id_story = u.id) AS at
                  FROM unnest($1::int[]) AS u(id)) x
            WHERE s.id = x.id`, [touched]);
        await c.query('COMMIT');
        fs.writeFileSync(backup, JSON.stringify({moves}, null, 1));
        console.log(`applied; backup in ${backup}`);
    } catch (err) {
        await c.query('ROLLBACK');
        throw err;
    }
}
await c.end();
