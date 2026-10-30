// personItem (person-items.js) as the link loop runs it, on persons linked to the one item called so: what
// it keeps now. Reads only (the database, Wikidata, the AI): node --env-file=.env bench/lone-items/live.mjs A,B
import {prisma} from '../../config/db.js';
import {personItem} from '../../services/utils/person-items.js';
import {newUsage} from '../../services/utils/ollama.js';

const usage = newUsage();
for (const name of process.argv[2].split(',')) {
    const [row] = await prisma.$queryRawUnsafe(`SELECT id, name, lang, qid FROM mentions WHERE kind = 'person' AND name = $1 AND qid IS NOT NULL ORDER BY seen DESC LIMIT 1`, name);
    if (!row) continue;
    // Wikidata lagging or refusing: asked again after the pause it asks for, as the link loop does later
    for (;;) {
        try {
            console.log(`${name}: ${row.qid} -> ${await personItem(row, row.qid, usage)}`);
            break;
        } catch (err) {
            if (!err.paused) throw err;
            await new Promise(resolve => setTimeout(resolve, (err.retryIn ?? 30e3) + 1000));
        }
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
}
console.log(`AI: ${usage.calls} calls, ${usage.input + usage.output} tokens`);
await prisma.$disconnect();
