//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: fifa-reread.js
//  Description: When a rule of the guide of the map of the FIFA presidency changes (services/utils/fifa-guide.md), the signals already read keep the old
//               answer: this reads a FAMILY of them again with the rules of now, by the same reading as the news that come, and says what changes. Nothing is
//               written without --apply. No line is edited by hand: the family is corrected by the logic
//
//  node --env-file=.env scripts/fifa-reread.js --family=praise [--apply]
//  node --env-file=.env scripts/fifa-reread.js --pattern="thank|credit" [--apply]     a regular expression of Postgres, case ignored
//

import process from 'node:process';
import {prisma} from '../config/db.js';
import {FifaService} from '../services/fifa-service.js';

// the words of each family, as a regular expression of Postgres (a stem, no word edge: it only chooses the signals to read again, the reading decides),
// and the reason of the rule: only a change that comes from this rule is kept
const FAMILIES = {
    // thanks, credit, praise, congratulations of the person or of what FIFA did (rule 5 of the guide: praise alone is no position)
    praise: {reason: 'praise', pattern: 'thank|grateful|gratitude|credit|prais|congratulat|applaud|benefit|merci|remerci|salue|felicit|gracias|agradec|elogi|obrigad|grazie|ringrazi|danke|dank|lof|prijs'},
};

const option = (name) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const family = FAMILIES[option('family')];
const pattern = family?.pattern ?? option('pattern');
const reason = family?.reason ?? option('reason') ?? null;
if (!pattern) {
    console.error(`usage: --family=${Object.keys(FAMILIES).join('|')} or --pattern=<regex> [--reason=<reason of the rule>] [--apply]`);
    process.exit(2);
}
const apply = process.argv.includes('--apply');

try {
    const answer = await FifaService.reread({pattern, reason, apply});
    console.log(`${answer.read} established signals match; ${answer.unchanged} stay as they are, ${answer.unread} could not be read again, ${answer.changed.length} change${apply ? ` (${answer.applied} written)` : ' (nothing written: add --apply)'}`);
    for (const one of answer.changed) console.log(`  #${one.id} ${one.member}: ${one.before} -> ${one.after}${one.reason ? ` (${one.reason})` : ''} | ${one.sentence}`);
    if (answer.noise.length > 0) console.log(`${answer.noise.length} more would change for another cause (the two readings do not agree every time): left alone`);
    for (const one of answer.noise) console.log(`  (left alone) #${one.id} ${one.member}: ${one.before} -> ${one.after}${one.reason ? ` (${one.reason})` : ''}`);
    console.log(`${answer.tokens.calls} calls, ${answer.tokens.input} tokens in, ${answer.tokens.output} out`);
} finally {
    await prisma.$disconnect();
}
