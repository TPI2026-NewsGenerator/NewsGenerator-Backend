// Prints the cards of a briefing to judge them by hand: title, interest, the news of its story, its other
// angles, Contested, Official source. From a file of enzo-measure.mjs or a saved briefing id:
//   node --env-file=.env bench/enzo-show.mjs bench/data/enzo-measure-7-1.json
//   node --env-file=.env bench/enzo-show.mjs 98
import process from 'node:process';
import {readFileSync} from 'node:fs';
import pg from 'pg';

const arg = process.argv[2];
let cards;
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
if (/^\d+$/.test(arg)) {
    const {rows: [b]} = await c.query('SELECT id_profile, hours, created_at, items FROM briefings WHERE id = $1', [arg]);
    console.log(`briefing ${arg}, profile ${b.id_profile}, ${b.hours} h, ${b.created_at.toISOString()}`);
    cards = b.items;
    for (const card of cards) {
        card.members = (await c.query(`SELECT id_story, to_char(COALESCE(published_at, created_at), 'DD HH24:MI') at, medium, lang, left(title, 140) title
            FROM articles WHERE id_story = ANY($1) ORDER BY id_story, 2`, [[card.storyId, ...(card.mergedStoryIds ?? [])]])).rows;
    }
} else {
    const data = JSON.parse(readFileSync(arg, 'utf8'));
    console.log(`profile ${data.profileId}, ${data.hours} h, ${data.took} s, ${data.seconds}`);
    cards = data.cards;
}
await c.end();
const MAX_MEMBERS = Number(process.env.MEMBERS ?? 12);
for (const [i, card] of cards.entries()) {
    const media = card.corroboration?.mediaNames ?? [];
    console.log(`\n#${i + 1} [${card.language}] ${card.title}${card.titleTranslation ? `\n    = ${card.titleTranslation}` : ''}`);
    console.log(`    interest: ${card.interest} | why: ${card.why}`);
    console.log(`    media ${media.length}: ${media.slice(0, 8).join(', ')}${card.followUp ? ' | FOLLOW-UP' : ''}${card.mergedStoryIds?.length ? ` | merged ${card.mergedStoryIds.length}` : ''}`);
    const members = card.members ?? [];
    console.log(`    story news ${members.length}:`);
    for (const m of members.slice(0, MAX_MEMBERS)) console.log(`      ${m.id_story === card.storyId ? ' ' : '+'} ${m.at} [${m.lang}] ${m.title}  (${m.medium})`);
    for (const a of card.angles ?? []) console.log(`    ANGLE ${a.named ? '(named) ' : ''}${a.publishedAt?.slice(5, 16) ?? ''} [${a.language}] ${a.title}${a.titleTranslation ? ` = ${a.titleTranslation}` : ''}  (${a.source})`);
    for (const d of card.contested ?? []) console.log(`    CONTESTED by ${d.by}: ${d.sentence}${d.translation ? ` = ${d.translation}` : ''}  (${d.source})`);
    for (const o of card.official ?? []) console.log(`    OFFICIAL ${o.party} [${o.channel}]: ${o.title}${o.translation ? ` = ${o.translation}` : ''}  (${o.source ?? o.url})`);
}
