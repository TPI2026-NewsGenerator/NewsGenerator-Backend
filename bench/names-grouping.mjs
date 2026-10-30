// Read only: would the names of the news (the tagger, article_mentions) group the news better? Scored
// against two sets read by hand before the tagger existed:
//   1. data/story-drift: 40 stories of 28.09, each news labelled affair + fact (facts.json). Pairs of
//      news of two media inside one story: same fact (must stay together), same affair other fact
//      (apart at the fact level), other affair (a wrong grouping)
//   2. data/merge: pairs of close stories (cos 0.6-0.95, often two languages) labelled one fact or
//      not (lists-src.json): the merges the vectors hesitate on
// For each pair: the actors (person, organization) and the places they share, a name counted once
// per item of Wikidata. Rules scored:
//   guard  "apart when both name actors and share none" (and the same with the places)
//   join   "together when they share k rare actors" (named by at most RARE news)
//   node --env-file=.env bench/names-grouping.mjs  -> bench/data/names-grouping.txt
import fs from 'node:fs';
import pg from 'pg';

const RARE = Number(process.env.RARE ?? 400);
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const read = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));

// {articleId: {actors: Map item -> seen, places: Map item -> seen, tagged}}
const namesOf = async (ids) => {
    const {rows} = await client.query(`
        SELECT a.id, a.entities_at IS NOT NULL AS tagged, m.kind, COALESCE(m.qid, m.kind || ':' || m.key) AS item, m.seen
        FROM articles a LEFT JOIN article_mentions am ON am.id_article = a.id LEFT JOIN mentions m ON m.id = am.id_mention
        WHERE a.id = ANY($1::int[])`, [ids]);
    const names = new Map();
    for (const row of rows) {
        const news = names.get(row.id) ?? {actors: new Map(), places: new Map(), tagged: row.tagged};
        names.set(row.id, news);
        if (!row.item) continue;
        (row.kind === 'location' ? news.places : news.actors).set(row.item, row.seen);
    }
    return names;
};

const shared = (a, b) => [...a.keys()].filter(item => b.has(item));
const features = (a, b) => {
    const actors = shared(a.actors, b.actors);
    return {
        actors: actors.length,
        rare: actors.filter(item => a.actors.get(item) <= RARE).length,
        noActorConflict: a.actors.size > 0 && b.actors.size > 0 && actors.length === 0,
        noPlaceConflict: a.places.size > 0 && b.places.size > 0 && shared(a.places, b.places).length === 0,
        bare: a.actors.size === 0 || b.actors.size === 0,
    };
};
const pct = (n, d) => d ? `${(100 * n / d).toFixed(0)}%`.padStart(4) : '   -';
const lines = [];
const table = (title, classes) => {
    lines.push(title, `  ${'class'.padEnd(28)} pairs  share>=1  rare>=1  rare>=2  no actor shared  no place shared  one side without actors`);
    for (const [name, pairs] of classes) {
        const n = pairs.length;
        const count = (test) => pairs.filter(test).length;
        lines.push(`  ${name.padEnd(28)} ${String(n).padStart(5)}  ${pct(count(p => p.f.actors >= 1), n)}      ${pct(count(p => p.f.rare >= 1), n)}     ${pct(count(p => p.f.rare >= 2), n)}     ${pct(count(p => p.f.noActorConflict), n)}             ${pct(count(p => p.f.noPlaceConflict), n)}             ${pct(count(p => p.f.bare), n)}`);
    }
    lines.push('');
};

// 1. the stories of 28.09, pairs of news of two media
const sample = read('./data/story-drift/sample.json');
const facts = read('./data/story-drift/facts.json').stories;
const drift = await namesOf(sample.flatMap(story => story.members.map(member => member.id)));
const driftPairs = [];
sample.forEach((story, s) => story.members.forEach((a, i) => story.members.forEach((b, j) => {
    if (j <= i || a.medium === b.medium || !drift.has(a.id) || !drift.has(b.id)) return;
    const [la, lb] = [facts[s][i], facts[s][j]];
    const kind = la === lb ? 'same fact' : la[0] === lb[0] ? 'same affair, other fact' : 'other affair';
    driftPairs.push({kind, a, b, f: features(drift.get(a.id), drift.get(b.id))});
})));
const driftNews = [...drift.values()];
lines.push(`news of the 40 stories: ${driftNews.length} of ${sample.reduce((n, s) => n + s.members.length, 0)} still kept, ${driftNews.filter(n => n.tagged).length} tagged, ${driftNews.filter(n => n.actors.size).length} with an actor; rare = named by <= ${RARE} news`, '');
table('1. Pairs of news inside the stories of 28.09 (two media)', ['same fact', 'same affair, other fact', 'other affair']
    .map(kind => [kind, driftPairs.filter(p => p.kind === kind)]));

// 2. the close stories of the merge lists: a story is the union of its news
const raw = read('./data/merge/pairs-raw.json');
const lists = read('./data/merge/lists-src.json').lists;
const storyOf = (ref) => raw[Number(ref.slice(0, -1))][ref.at(-1).toLowerCase()];
const titleOf = (ref) => raw[Number(ref.slice(0, -1))][`t${ref.at(-1).toLowerCase()}`];
const storyIds = [...new Set(lists.flatMap(list => list.facts.flat().map(storyOf)))];
const {rows: members} = await client.query('SELECT id, id_story, title FROM articles WHERE id_story = ANY($1::int[])', [storyIds]);
const names = await namesOf(members.map(m => m.id));
const stories = new Map();
for (const m of members) {
    const story = stories.get(m.id_story) ?? {actors: new Map(), places: new Map(), titles: new Set(), news: 0};
    stories.set(m.id_story, story);
    const news = names.get(m.id);
    story.news++;
    story.titles.add(m.title);
    for (const [item, seen] of news.actors) story.actors.set(item, seen);
    for (const [item, seen] of news.places) story.places.set(item, seen);
}
const {rows: cosRows} = await client.query(`
    SELECT x.id AS a, y.id AS b, (-(x.centroid <#> y.centroid))::real AS cos FROM stories x JOIN stories y ON x.id < y.id
    WHERE x.id = ANY($1::int[]) AND y.id = ANY($1::int[]) AND x.centroid IS NOT NULL AND y.centroid IS NOT NULL`, [storyIds]);
const cosOf = new Map(cosRows.map(r => [`${r.a} ${r.b}`, r.cos]));
const stale = lists.flatMap(list => list.facts.flat()).filter(ref => !stories.get(storyOf(ref))?.titles.has(titleOf(ref)));
lines.push(`stories of the merge lists: ${stories.size} of ${storyIds.length} still kept, ${stale.length} no longer holding their labelled lead`, '');
const mergePairs = [];
for (const list of lists) {
    const refs = list.facts.flat().filter(ref => !stale.includes(ref));
    const factOf = new Map(list.facts.flatMap((fact, i) => fact.map(ref => [ref, i])));
    const maybe = new Set(list.maybe.map(pair => [...pair].sort().join()));
    refs.forEach((a, i) => refs.slice(i + 1).forEach(b => {
        if (maybe.has([a, b].sort().join())) return;
        const [sa, sb] = [storyOf(a), storyOf(b)];
        if (sa === sb) return;
        const cos = cosOf.get(`${Math.min(sa, sb)} ${Math.max(sa, sb)}`);
        mergePairs.push({kind: factOf.get(a) === factOf.get(b) ? 'one fact' : 'two facts', list: list.name, a, b, cos,
            ta: titleOf(a), tb: titleOf(b), f: features(stories.get(sa), stories.get(sb))});
    }));
}
const close = (p) => p.cos >= 0.6;
table('2. Pairs of stories of the merge lists', [
    ['one fact', mergePairs.filter(p => p.kind === 'one fact')],
    ['two facts', mergePairs.filter(p => p.kind === 'two facts')],
    ['two facts, centroids >= 0.6', mergePairs.filter(p => p.kind === 'two facts' && close(p))],
]);

// the rules, as decisions: what each would fix and what it would break
const rule = (name, pairs, apart, together, test) => {
    const fixed = pairs.filter(p => p.kind !== together && test(p)).length;
    const broken = pairs.filter(p => p.kind === together && test(p)).length;
    lines.push(`  ${name.padEnd(62)} breaks ${broken}/${pairs.filter(p => p.kind === together).length} right pairs, catches ${fixed}/${pairs.filter(p => p.kind !== together).length} ${apart}`);
};
lines.push('Guards (inside the stories: would split)');
const inside = driftPairs.filter(p => p.kind !== 'same affair, other fact');
rule('no actor shared', inside, 'other-affair pairs', 'same fact', p => p.f.noActorConflict);
rule('no actor and no place shared', inside, 'other-affair pairs', 'same fact', p => p.f.noActorConflict && p.f.noPlaceConflict);
rule('no actor shared (same affair, other fact as the wrong ones)', driftPairs.filter(p => p.kind !== 'other affair'), 'other-fact pairs', 'same fact', p => p.f.noActorConflict);
lines.push('', 'Joins (close stories: would merge when the rule holds)');
for (const k of [1, 2, 3]) {
    const test = (p) => p.f.rare >= k;
    const hits = mergePairs.filter(test);
    lines.push(`  share >= ${k} rare actor(s): ${hits.length} pairs, ${hits.filter(p => p.kind === 'one fact').length} one fact (${pct(hits.filter(p => p.kind === 'one fact').length, hits.length)}), ${mergePairs.filter(p => p.kind === 'one fact').length} one-fact pairs in all`);
}
for (const k of [1, 2]) {
    const test = (p) => p.f.rare >= k && !p.f.noPlaceConflict;
    const hits = mergePairs.filter(test);
    lines.push(`  share >= ${k} rare actor(s), no place conflict: ${hits.length} pairs, ${hits.filter(p => p.kind === 'one fact').length} one fact (${pct(hits.filter(p => p.kind === 'one fact').length, hits.length)})`);
}
lines.push('', 'Guard on the merges: one-fact pairs with no actor shared (would be refused)');
rule('no actor shared', mergePairs, 'two-fact pairs', 'one fact', p => p.f.noActorConflict);
rule('no actor and no place shared', mergePairs, 'two-fact pairs', 'one fact', p => p.f.noActorConflict && p.f.noPlaceConflict);

lines.push('', 'Details: the pairs a rule gets wrong, to read');
for (const p of driftPairs.filter(p => p.kind === 'same fact' && p.f.noActorConflict).slice(0, 15))
    lines.push(`  split by the guard, same fact: "${p.a.title}" | "${p.b.title}"`);
for (const p of driftPairs.filter(p => p.kind === 'other affair')) lines.push(`  other affair ${p.f.noActorConflict ? 'CAUGHT' : 'missed'} (${p.f.actors} shared): "${p.a.title}" | "${p.b.title}"`);
for (const p of mergePairs.filter(p => p.f.rare >= 1)) lines.push(`  join ${p.kind === 'one fact' ? 'RIGHT' : 'WRONG'} (${p.f.rare} rare, cos ${p.cos?.toFixed(2)}): "${p.ta}" | "${p.tb}"`);
for (const p of mergePairs.filter(p => p.kind === 'one fact' && p.f.rare === 0)) lines.push(`  one fact, no rare actor shared (cos ${p.cos?.toFixed(2)}): "${p.ta}" | "${p.tb}"`);

fs.writeFileSync(new URL('./data/names-grouping.txt', import.meta.url), lines.join('\n') + '\n');
console.log(lines.slice(0, 40).join('\n'));
await client.end();
