// The names linked to an item of Wikidata that is no person, body nor place (a family name, a given
// name: see NOT_NAMED in wikidata.js), linked before their descriptions were read in English: looked
// for again. DRY=1 lists them only
//   node --env-file=.env bench/unlink-not-named.mjs
import {prisma} from '../config/db.js';

const NOT_NAMED = /^(Wikimedia |family name|surname|given name|male given name|female given name|unisex given name|scholarly article|scientific article)/i;
const qids = (await prisma.$queryRawUnsafe(`SELECT DISTINCT qid FROM mentions WHERE qid IS NOT NULL`)).map(row => row.qid);
const wrong = [];
for (let i = 0; i < qids.length; i += 50) {
    const params = new URLSearchParams({action: 'wbgetentities', ids: qids.slice(i, i + 50).join('|'), props: 'descriptions', languages: 'en', format: 'json'});
    let answer = null;
    // refused ("too many requests", shared with the names linked in background): asked again later
    for (let attempt = 0; answer === null && attempt < 5; attempt++) {
        const text = await (await fetch(`https://www.wikidata.org/w/api.php?${params}`, {headers: {'User-Agent': 'NewsGenerator/1.0 (self-hosted news reader)'}})).text();
        try { answer = JSON.parse(text); } catch { await new Promise(resolve => setTimeout(resolve, 30000)); }
    }
    if (answer === null) throw new Error('Wikidata kept refusing');
    for (const [qid, item] of Object.entries(answer.entities ?? {})) if (NOT_NAMED.test(item.descriptions?.en?.value ?? '')) wrong.push(qid);
    await new Promise(resolve => setTimeout(resolve, 5000));
}
const rows = await prisma.$queryRawUnsafe(`SELECT id, name, qid FROM mentions WHERE qid = ANY($1::text[])`, wrong);
console.log(`${qids.length} items linked, ${wrong.length} no person, body nor place: ${rows.map(row => `${row.name} (${row.qid})`).join(', ')}`);
if (!process.env.DRY && rows.length > 0) {
    console.log(`looked for again: ${await prisma.$executeRawUnsafe(`UPDATE mentions SET qid = NULL, linked_at = NULL WHERE qid = ANY($1::text[])`, wrong)}`);
}
await prisma.$disconnect();
