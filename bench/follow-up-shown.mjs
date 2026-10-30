// A card sent by e-mail comes back as a follow-up when the AI reads something new in the news of its
// affair since (repeats.js); the check (checkStories) then keeps on the card only the articles telling
// the news of its lead. 17.10.2026: the new fact of a card on Infantino was in an article the check
// took off the card. For each follow-up of the stored briefings: the news the evolution read (rebuilt
// from the database: the news of its story in the window, published after the card shown and stored
// before the briefing), which of them are on the card, and the evolution asked again twice on them and
// twice on the card's own articles published since the card shown (the check keeps them, with its
// versions in other languages). Read only, the AI paid (gemma4:31b, a few cents).
//   node --env-file=.env bench/follow-up-shown.mjs [days=7]
import process from 'node:process';
import pg from 'pg';
import {evolvedStories} from '../services/utils/repeats.js';

const DAYS = Number(process.argv[2] ?? 7);
const NEW_TITLES = 6;       // as repeats.js
const RUNS = 2;

const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const {rows: cards} = await c.query(`SELECT b.id AS briefing, b.created_at, b.hours, i AS item
    FROM briefings b, jsonb_array_elements(b.items) i
    WHERE b.created_at > now() - make_interval(days => $1) AND jsonb_typeof(i->'followUp') = 'object'
    ORDER BY b.id`, [DAYS]);

const results = [];
const NONE = {evolved: false, fact: null};
for (const {briefing, created_at: at, hours, item} of cards) {
    const followUp = item.followUp;
    const {rows: members} = await c.query(`SELECT DISTINCT ON (a.link) a.link, a.resolved_link, a.title, a.description,
            COALESCE(a.published_at, a.created_at) AS at
        FROM articles a
        WHERE a.id_story = $1 AND a.created_at <= $2 AND COALESCE(a.published_at, a.created_at) >= $2::timestamptz - make_interval(hours => $3)
        ORDER BY a.link, COALESCE(a.published_at, a.created_at) DESC`, [item.storyId, at, hours]);
    const shownAt = new Date(followUp.shownAt);
    const since = members.filter(article => article.at > shownAt);
    const read = (since.length > 0 || followUp.evolved ? since : members).sort((a, b) => b.at - a.at).slice(0, NEW_TITLES);
    // a card keeps one article a medium: one of the same title is on it too
    const onCard = new Set([item.lead?.url, ...(item.articles ?? []).map(article => article.url)].filter(Boolean));
    const titles = new Set([item.lead?.title, ...(item.articles ?? []).map(article => article.title)].filter(Boolean).map(title => title.trim()));
    const shown = (article) => onCard.has(article.link) || onCard.has(article.resolved_link) || titles.has(article.title.trim());
    const kept = read.filter(shown);
    // what the evolution would read on the card: its articles published since the card shown (all of
    // its members when it is another story of the affair without news since), the newest first
    const {rows: described} = await c.query(`SELECT DISTINCT ON (link) link, resolved_link, description FROM articles
        WHERE link = ANY($1::text[]) OR resolved_link = ANY($1::text[])`, [[...onCard]]);
    const descriptionOf = new Map(described.flatMap(row => [[row.link, row.description], [row.resolved_link, row.description]]));
    const cardArticles = (item.articles ?? []).map(article => ({title: article.title, description: descriptionOf.get(article.url) ?? '', at: new Date(article.publishedAt)}));
    const cardSince = cardArticles.filter(article => article.at > shownAt);
    const cardNews = (cardSince.length > 0 || followUp.evolved ? cardSince : cardArticles).sort((a, b) => b.at - a.at).slice(0, NEW_TITLES);

    const ask = async (news) => {
        if (news.length === 0) return {evolved: false, fact: null};
        const answer = await evolvedStories([{id: String(item.storyId), title: followUp.title, since: news}]);
        return {evolved: answer.has(String(item.storyId)), fact: answer.get(String(item.storyId)) ?? null};
    };
    const all = [], cardOnly = [];
    for (let run = 0; run < RUNS; run++) {
        all.push(await ask(read));
        cardOnly.push(await ask(cardNews));
    }
    results.push({briefing, storyId: item.storyId, same: followUp.evolved, read: read.length, kept: kept.length, all, cardOnly});

    console.log(`\n#${briefing} story ${item.storyId}${followUp.evolved ? '' : ` (another story of the affair of ${followUp.storyId})`}`);
    console.log(`  read before: ${followUp.title}`);
    console.log(`  card: ${item.title}`);
    for (const article of read) console.log(`  ${shown(article) ? 'ON CARD ' : 'dropped '} ${article.title.slice(0, 120)}`);
    for (const article of cardNews) console.log(`  card since: ${article.title.slice(0, 120)}`);
    console.log(`  all news:     ${all.map(r => r.evolved ? `new (${r.fact})` : 'not new').join(' | ')}`);
    console.log(`  card's news since (${cardNews.length}):  ${cardOnly.map(r => r.evolved ? `new (${r.fact})` : 'not new').join(' | ')}`);
}
await c.end();

const count = (filter) => results.filter(filter).length;
console.log(`\n${results.length} follow-ups in ${DAYS} days`);
console.log(`  none of the news the evolution read on the card: ${count(r => r.kept === 0)}`);
console.log(`  some of them dropped: ${count(r => r.kept > 0 && r.kept < r.read)}, all on the card: ${count(r => r.kept === r.read)}`);
console.log(`  new on all its news in both runs: ${count(r => r.all.every(x => x.evolved))}, in one: ${count(r => r.all.filter(x => x.evolved).length === 1)}`);
console.log(`  of the ones new in both runs, not new on the card's news in both runs: ${count(r => r.all.every(x => x.evolved) && r.cardOnly.every(x => !x.evolved))}, in one: ${count(r => r.all.every(x => x.evolved) && r.cardOnly.filter(x => x.evolved).length === 1)}`);
