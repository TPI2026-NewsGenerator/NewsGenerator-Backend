//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: fifa-audit.js
//  Description: The audit of the positions the map of the FIFA presidency shows, by hand (the server makes it once a week by itself): a sample of the
//               established signals read again by a third model, and the votes of the readers against the news. Prints the report; exits with 1
//               when the agreement is under the threshold (FIFA_AUDIT_MIN_AGREEMENT, 85% by default)
//
//  node --env-file=.env scripts/fifa-audit.js [--days=7] [--sample=30] [--dry]     --dry: nothing is kept in fifa_audits
//

import process from 'node:process';
import {prisma} from '../config/db.js';
import {FifaService} from '../services/fifa-service.js';

const option = (name, fallback) => {
    const found = process.argv.find(arg => arg.startsWith(`--${name}=`));
    return found ? Number(found.split('=')[1]) : fallback;
};

try {
    const result = await FifaService.audit({days: option('days', 7), sample: option('sample', 30), dry: process.argv.includes('--dry')});
    console.log(result.report);
    console.log(`\n${result.details.tokens.calls} calls, ${result.details.tokens.input} tokens in, ${result.details.tokens.output} out${process.argv.includes('--dry') ? ' (dry: not kept)' : ' (kept in fifa_audits)'}`);
    process.exitCode = result.verdict === 'warning' ? 1 : 0;
} finally {
    await prisma.$disconnect();
}
