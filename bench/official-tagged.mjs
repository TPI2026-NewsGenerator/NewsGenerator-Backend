// Read only: would the names the tagger linked to Wikidata (mentions.qid) spare the searches of the
// official sources (party_names, searched in Wikidata then picked by the AI)? For the parties searched
// lately: how many of their names the tagger linked, and whether its item is the one picked
//   node --env-file=.env bench/official-tagged.mjs [days]
import {prisma} from '../config/db.js';
import {mentionKey} from '../services/utils/mentions.js';

const days = Number(process.argv[2] ?? 14);
const parties = await prisma.$queryRawUnsafe(`SELECT name, what, qid, checked_at FROM party_names WHERE checked_at > now() - make_interval(days => $1::int)`, days);
const keys = [...new Set(parties.map(party => mentionKey(party.name)))];
const linked = await prisma.$queryRawUnsafe(`SELECT key, array_agg(DISTINCT qid) AS qids FROM mentions WHERE key = ANY($1::text[]) AND qid IS NOT NULL GROUP BY key`, keys);
const qidsOf = new Map(linked.map(row => [row.key, row.qids]));
let hit = 0, same = 0, differ = 0, pickedNone = 0;
const wrong = [];
for (const party of parties) {
    const qids = qidsOf.get(mentionKey(party.name));
    if (!qids || qids.length !== 1) continue;
    hit++;
    if (party.qid === null) pickedNone++;
    else if (party.qid === qids[0]) same++;
    else { differ++; wrong.push(`${party.name} (${party.what}): picked ${party.qid}, tagger ${qids[0]}`); }
}
console.log(`${parties.length} parties searched in ${days} days; the tagger linked ${hit} of their names: same item ${same}, another ${differ}, the search found none ${pickedNone}`);
console.log(wrong.slice(0, 20).join('\n'));
await prisma.$disconnect();
