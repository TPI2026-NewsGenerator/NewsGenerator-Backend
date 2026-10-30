// What the AI answers (the path of organizationItem when the one item is not kept) for the names a guard
// sends to it: the item it chooses, null when none. node --env-file=.env bench/org-country/ai.mjs
import fs from 'node:fs';
import {namedItems, describeItems} from '../../services/utils/wikidata.js';
import {ollamaJson} from '../../services/utils/ollama.js';
import {organizationPrompt, MIN_SITELINKS} from '../../services/utils/organization-items.js';
import {MentionModel} from '../../models/mention-model.js';
import {prisma} from '../../config/db.js';

const features = JSON.parse(fs.readFileSync(new URL('./features.json', import.meta.url), 'utf8'));
const names = process.argv.slice(2);
for (const e of features.filter(e => names.includes(e.name))) {
    const found = await namedItems(e.name, e.lang ?? 'en');
    const exact = found.filter(item => item.exact);
    const described = await describeItems(found.map(item => item.qid));
    const items = described.filter(item => !item.human);
    const titles = await MentionModel.titlesNaming(e.id, 5);
    const answer = await ollamaJson(organizationPrompt(e.name, titles, items), null);
    const chosen = items[Number(answer?.n) - 1];
    const kept = chosen && chosen.links >= (exact.length === 1 ? 1 : MIN_SITELINKS) ? chosen : null;
    console.log(`${e.name} [${e.lang}] judged ${e.verdict} (linked ${e.qid}): ${items.length} items, AI ${JSON.stringify(answer)} -> ${kept ? `${kept.qid} ${kept.label} (${kept.description})` : 'none'}`);
    console.log(`   titles: ${titles.slice(0, 3).join(' | ').slice(0, 220)}`);
}
await prisma.$disconnect();
