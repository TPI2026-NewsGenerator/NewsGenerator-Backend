// How many cards of the saved briefings show a standing picture (taller than wide), and whether another picture of their articles is wide: friend's point 5,
// 10.11.2026 ("une photo en mode portrait, est-ce possible de la couper en paysage ou d'en prendre une autre ?")
//   node --env-file=.env bench/portrait-count.mjs [days=21]
import process from 'node:process';
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const {rows} = await c.query(`SELECT id, items FROM briefings WHERE status = 'ready' AND created_at > now() - make_interval(days => $1)`, [Number(process.argv[2] ?? 21)]);
await c.end();
const seen = new Set();
const stats = {cards: 0, withThumb: 0, sizeKnown: 0, standing: 0, standingWithWide: 0, illustration: 0};
const examples = [];
for (const row of rows) for (const item of Array.isArray(row.items) ? row.items : []) {
    if (!(item.storyId > 0) || seen.has(item.storyId)) continue;
    seen.add(item.storyId);
    stats.cards++;
    if (!item.thumbnail) continue;
    stats.withThumb++;
    const mine = (item.pictures ?? []).find(picture => picture.url === item.thumbnail) ?? (item.illustration?.url === item.thumbnail ? {url: item.thumbnail, ...item.illustration} : null);
    if (!mine?.width) continue;
    stats.sizeKnown++;
    if (item.illustration?.url === item.thumbnail) stats.illustration++;
    if (mine.width / mine.height >= 0.9) continue;
    stats.standing++;
    const wide = (item.pictures ?? []).filter(picture => picture.url !== item.thumbnail && picture.width / picture.height >= 1.3 && picture.width >= 560);
    if (wide.length > 0) stats.standingWithWide++;
    examples.push({briefing: row.id, ratio: (mine.width / mine.height).toFixed(2), size: `${mine.width}x${mine.height}`, wide: wide.length, title: (item.titleTranslation ?? item.title).slice(0, 70), source: item.thumbnailSource});
}
console.log(JSON.stringify(stats));
for (const e of examples.slice(0, 40)) console.log(`b${e.briefing} ${e.size} (${e.ratio}) wide alternatives ${e.wide} | ${e.source} | ${e.title}`);
