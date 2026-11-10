// How many titles of the saved briefings were rewritten by the AI by default (titleRewritten), how many kept a proposal that the checks or the second opinion
// refused (titleProposal), and what those proposals say: to decide what "neutral titles for everyone" would change (the user, 10.11.2026, a friend)
//   node --env-file=.env bench/title-proposals.mjs [days=14] [show=25]
import process from 'node:process';
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const {rows} = await c.query(`SELECT id, items FROM briefings WHERE status = 'ready' AND created_at > now() - make_interval(days => $1)`, [Number(process.argv[2] ?? 14)]);
await c.end();
const seen = new Set();
const stats = {cards: 0, rewritten: 0, proposalOnly: 0, shortened: 0, none: 0, withProblem: 0};
const proposals = [];
for (const row of rows) for (const item of Array.isArray(row.items) ? row.items : []) {
    if (!(item.storyId > 0) || seen.has(item.storyId)) continue;
    seen.add(item.storyId);
    stats.cards++;
    if (item.titleRewritten) stats.rewritten++;
    else if (item.titleProposal?.title && item.titleProposal.title !== item.title) {
        stats.proposalOnly++;
        if (item.titleProposal.problem) stats.withProblem++;
        proposals.push({shown: item.titleTranslation ?? item.title, proposal: item.titleProposal.title, problem: item.titleProposal.problem ?? null});
    } else if (item.titleAsPublished) stats.shortened++;
    else stats.none++;
}
console.log(JSON.stringify(stats));
for (const p of proposals.slice(0, Number(process.argv[3] ?? 25))) console.log(`${p.problem ? `[${p.problem}] ` : ''}${p.shown.slice(0, 110)}\n   -> ${p.proposal.slice(0, 110)}`);
