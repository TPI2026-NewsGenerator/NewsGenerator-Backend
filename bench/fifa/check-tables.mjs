//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: check-tables.mjs
//  Description: Reads, and writes nothing: whether db/add_fifa_map.sql was run (the five tables of the map of the FIFA presidency, the candidate
//               it starts with and what each table holds)
//
//  node --env-file=.env bench/fifa/check-tables.mjs
//

import {prisma} from '../../config/db.js';

const TABLES = ['fifa_subjects', 'fifa_signals', 'fifa_votes', 'fifa_leaders', 'fifa_audits'];
try {
    const found = new Set((await prisma.$queryRawUnsafe(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])`, TABLES)).map(row => row.table_name));
    for (const table of TABLES) {
        if (!found.has(table)) { console.log(`${table.padEnd(14)} MISSING`); continue; }
        const [{n}] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM public.${table}`);
        console.log(`${table.padEnd(14)} ok, ${n} rows`);
    }
    if (found.has('fifa_subjects')) console.log(await prisma.$queryRawUnsafe(`SELECT qid, name, status, state, color_index, terms FROM fifa_subjects ORDER BY color_index`));
} finally {
    await prisma.$disconnect();
}
