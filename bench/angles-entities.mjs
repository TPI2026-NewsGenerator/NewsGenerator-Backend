// Read only: do the names (people, organisations, places tagged in the news, mentions) a card and an
// angle candidate share tell the labeled right angles (G) from the theme (T), same fact (S), other
// card's fact (C) ones? For each labeled pair of the DATA files: shared names, shared rare names
// (seen in <= RARE news), Jaccard. node --env-file=.env bench/angles-entities.mjs
import fs from 'node:fs';
import pg from 'pg';

const RARE = 400;
const SETS = [['./data/angles-enzo98-base.json', './data/angles-enzo98-labels.json'], ['./data/angles-old47-base.json', './data/angles-places-labels.json']];
const read = (file) => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const rows = [];
for (const [data, labelFile] of SETS) {
    const labels = read(labelFile);
    for (const briefing of read(data)) {
        const pairs = briefing.cards.flatMap(card => card.others.map(other => [card.id, other.storyId, labels[`${card.id}:${other.storyId}`]]))
            .filter(([, , label]) => label);
        const ids = [...new Set(pairs.flatMap(([a, b]) => [a, b]))];
        const {rows: names} = await c.query(`SELECT DISTINCT a.id_story, COALESCE(m.qid, m.key) AS name, m.seen, m.kind
            FROM articles a JOIN article_mentions am ON am.id_article = a.id JOIN mentions m ON m.id = am.id_mention
            WHERE a.id_story = ANY($1::int[])`, [ids]);
        const of = new Map(ids.map(id => [id, new Map()]));
        for (const row of names) of.get(row.id_story).set(row.name, row.seen);
        for (const [card, angle, label] of pairs) {
            const a = of.get(card), b = of.get(angle);
            const shared = [...a.keys()].filter(name => b.has(name));
            const rare = shared.filter(name => (a.get(name) ?? 0) <= RARE);
            rows.push({label, shared: shared.length, rare: rare.length, jaccard: shared.length / (new Set([...a.keys(), ...b.keys()]).size || 1), empty: a.size === 0 || b.size === 0});
        }
    }
}
await c.end();
const median = (values) => { const s = [...values].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
for (const label of ['G', 'S', 'C', 'T', 'W']) {
    const of = rows.filter(row => row.label === label && !row.empty);
    if (of.length === 0) continue;
    const share = (test) => `${(100 * of.filter(test).length / of.length).toFixed(0)}%`;
    console.log(`${label} n=${of.length} (+${rows.filter(r => r.label === label && r.empty).length} untagged)  shared median ${median(of.map(r => r.shared))}, rare median ${median(of.map(r => r.rare))}, `
        + `jaccard median ${median(of.map(r => r.jaccard)).toFixed(2)} | no shared ${share(r => r.shared === 0)}, no rare shared ${share(r => r.rare === 0)}, 2+ rare ${share(r => r.rare >= 2)}`);
}
