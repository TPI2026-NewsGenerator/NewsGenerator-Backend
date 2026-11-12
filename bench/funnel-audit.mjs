//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: funnel-audit.mjs
//  Description: The funnel that leads from the news of the reader's feeds to the cards of a briefing (the user, 12.11.2026: "dans 200k nouvelles par jour, on
//               n'arrive pas à trouver 30 qui sont clairement pertinentes ... le filtrage/entonnoir ne laisse pas des cartes pertinentes s'échapper ?"): the
//               stories scored (RANKED_POOL), kept by interest (RANKED), credible, not shown before, picked as candidates, not old, chosen by the AI. Read with
//               the trace of write() (the briefing stops once the AI has chosen), then judged blind: which of the stories at each step are clearly for the reader
//
//  node --env-file=.env bench/funnel-audit.mjs trace <profile> [hours=24] [size=30]     the steps of one run: bench/data/funnel/<profile>.json (+ the news of the pool)
//  node --env-file=.env bench/funnel-audit.mjs judge <profile> [beyond=150]             the stories to judge: the ranked ones and a draw of the others, judge-<n>.md
//  node --env-file=.env bench/funnel-audit.mjs score <profile>                          reads labels-<n>.json (id -> CLEAR | MAYBE | NO): where the clear ones are lost
//

import process from 'node:process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {prisma} from '../config/db.js';

const DIR = 'bench/data/funnel';
const NL = String.fromCharCode(10);
const squash = (text) => String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const clip = (text, n) => squash(text).slice(0, n);
const file = (profile, name) => `${DIR}/${profile}-${name}`;
const load = (profile) => JSON.parse(readFileSync(file(profile, 'trace.json'), 'utf8'));

const trace = async (profile, hours = 24, size = 30) => {
    const {write} = await import('../services/briefing-service.js');
    const traced = {stop: true};
    await write(null, profile, hours, size, traced);
    // the news that stands for each story of the pool: its best one
    const ids = [...new Set(traced.pool.map(row => row.article))];
    const rows = await prisma.$queryRawUnsafe(`SELECT a.id, a.id_story, a.title, a.description, a.medium, a.lang, COALESCE(a.published_at, a.created_at) AS at FROM articles a WHERE a.id = ANY($1::int[])`, ids);
    const news = Object.fromEntries(rows.map(row => [row.id_story, {title: squash(row.title), description: clip(row.description, 300), medium: row.medium, lang: row.lang, at: row.at}]));
    // every story of the window told by a feed of the reader, scored or not; and the stories of every feed of the database, for the funnel of the user's question
    const [{total}] = await prisma.$queryRawUnsafe(`SELECT count(DISTINCT a.id_story)::int AS total FROM articles a JOIN feeds f ON f.id = a.id_feed WHERE f.url = ANY($1::text[]) AND a.id_story IS NOT NULL AND COALESCE(a.published_at, a.created_at) >= $2::timestamptz`,
        traced.feedUrls, new Date(Date.now() - hours * 3600e3));
    const [{all}] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS all FROM articles a WHERE COALESCE(a.published_at, a.created_at) >= $1::timestamptz`, new Date(Date.now() - hours * 3600e3));
    mkdirSync(DIR, {recursive: true});
    writeFileSync(file(profile, 'trace.json'), JSON.stringify({...traced, news, hours, size, at: new Date().toISOString(), inWindowStories: total, inWindowArticles: all}));
    const n = (list) => list?.length ?? 0;
    console.log(`profile ${profile}: ${traced.feedUrls.length} feeds; news of the window in the database ${all}, stories of the reader's feeds ${total}; scored ${n(traced.pool)}, kept by interest ${n(traced.ranked)}, credible ${n(traced.credible)}, not shown before ${n(traced.fresh)}, picked ${n(traced.kept)}, not old ${n(traced.candidates)}, asked ${n(traced.asked)}, chosen ${n(traced.chosen)}`);
};

const judge = async (profile, beyond = 150) => {
    const t = load(profile);
    const ranked = new Set(t.ranked);
    const inRanked = t.pool.filter(row => ranked.has(row.story));
    const others = t.pool.filter(row => !ranked.has(row.story));
    let seed = 20261112;
    const random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const drawn = others.map(row => [random(), row]).sort((x, y) => x[0] - y[0]).slice(0, beyond).map(([, row]) => row);
    // the stories of the reader's feeds that were not even scored (the pool is the 1800 closest): a draw among the ones whose title holds a word of the profile's
    // subjects (the bodies, the referees, the federations in a dozen languages), the rest being far from every interest by the vectors
    const SIGNAL = 'uefa|fifa|ifab|arbitr|referee|schiedsrichter|\\mvar\\M|árbitro|arbitre|scheidsrechter|sędzi|sudij|hakem|διαιτ|ΕΠΟ|حكم|federation|federación|federazione|fédération|föderation|football association|federat|verband|savez|szövetség|asociaci|associazione|jalgpalliliit|futbolo|futbola|fotbal';
    const pooled = t.pool.map(row => row.story);
    const signal = (await prisma.$queryRawUnsafe(`
        SELECT DISTINCT ON (a.id_story) a.id_story AS story, a.title, left(a.description, 300) AS description, a.medium, a.lang
        FROM articles a JOIN feeds f ON f.id = a.id_feed
        WHERE f.url = ANY($1::text[]) AND a.id_story IS NOT NULL AND NOT (a.id_story = ANY($2::int[]))
          AND COALESCE(a.published_at, a.created_at) >= $3::timestamptz AND a.title ~* $4
        ORDER BY a.id_story, COALESCE(a.published_at, a.created_at) DESC`,
        t.feedUrls, pooled, new Date(new Date(t.at).getTime() - t.hours * 3600e3), SIGNAL)).map(row => ({...row, title: squash(row.title), description: clip(row.description, 300)}));
    const signalDrawn = signal.map(row => [random(), row]).sort((x, y) => x[0] - y[0]).slice(0, 120).map(([, row]) => row);
    for (const row of signalDrawn) t.news[row.story] = {title: row.title, description: row.description, medium: row.medium, lang: row.lang};
    const all = [...inRanked, ...drawn, ...signalDrawn.map(row => ({story: row.story}))].map(row => [random(), row]).sort((x, y) => x[0] - y[0]).map(([, row]) => row);
    const lines = all.filter(row => t.news[row.story]).map(row => `[${row.story}] ${t.news[row.story].title}${t.news[row.story].description ? ` — ${t.news[row.story].description}` : ''} (${t.news[row.story].medium}, ${t.news[row.story].lang ?? '?'})`);
    mkdirSync(DIR, {recursive: true});
    const CHUNK = 150;
    for (let i = 0; i < lines.length; i += CHUNK) writeFileSync(file(profile, `judge-${String(i / CHUNK + 1).padStart(2, '0')}.md`), lines.slice(i, i + CHUNK).join(NL + NL));
    writeFileSync(file(profile, 'profile.md'), t.wanted);
    writeFileSync(file(profile, 'judged.json'), JSON.stringify({ranked: inRanked.length, drawn: drawn.length, beyondTotal: others.length, signalTotal: signal.length, signalDrawn: signalDrawn.length, signalIds: signalDrawn.map(row => row.story)}));
    console.log(`${lines.length} stories to judge (${inRanked.length} kept by interest, ${drawn.length} drawn among the ${others.length} others of the pool, ${signalDrawn.length} drawn among the ${signal.length} not scored with a word of the subjects) in ${Math.ceil(lines.length / CHUNK)} files`);
};

const score = (profile) => {
    const t = load(profile);
    const labels = new Map();
    for (let n = 1; n <= 20; n++) {
        const name = file(profile, `labels-${String(n).padStart(2, '0')}.json`);
        if (existsSync(name)) for (const [id, value] of Object.entries(JSON.parse(readFileSync(name, 'utf8')))) labels.set(Number(id), value);
    }
    const set = (list) => new Set(list);
    const stages = [['scored (pool)', set(t.pool.map(row => row.story))], ['kept by interest', set(t.ranked)], ['credible', set(t.credible)], ['not shown before', set(t.fresh)],
        ['picked as candidates', set(t.kept)], ['not old news', set(t.candidates)], ['chosen by the AI', set(t.chosen.map(item => Number(item.id)))]];
    const judged = [...labels.keys()];
    const meta = JSON.parse(readFileSync(file(profile, 'judged.json'), 'utf8'));
    const clear = judged.filter(id => labels.get(id) === 'CLEAR'), maybe = judged.filter(id => labels.get(id) === 'MAYBE');
    console.log(`${judged.length} stories judged (${meta.ranked} kept by interest, ${meta.drawn} drawn among the ${meta.beyondTotal} others): CLEAR ${clear.length}, MAYBE ${maybe.length}, NO ${judged.length - clear.length - maybe.length}`);
    const ranked = set(t.ranked);
    const clearRanked = clear.filter(id => ranked.has(id)), clearBeyond = clear.filter(id => !ranked.has(id));
    console.log(`clearly for the reader: ${clearRanked.length} among the ${meta.ranked} kept by interest, ${clearBeyond.length} among the ${meta.drawn} drawn from the ${meta.beyondTotal} others (about ${Math.round(clearBeyond.length / Math.max(1, meta.drawn) * meta.beyondTotal)} in all)`);
    for (const [name, ids] of stages.slice(1)) {
        const has = (id) => ids.has(id);
        console.log(`${name.padEnd(22)} ${String(ids.size).padStart(4)} stories | clear ${String(clearRanked.filter(has).length).padStart(3)} of ${clearRanked.length} | maybe ${String(maybe.filter(id => ranked.has(id) && has(id)).length).padStart(3)} of ${maybe.filter(id => ranked.has(id)).length}`);
    }
    const chosen = stages.at(-1)[1];
    const lost = (ids, from, to) => ids.filter(id => from.has(id) && !to.has(id));
    for (let i = 1; i < stages.length - 1; i++) {
        const gone = lost(clearRanked, stages[i][1], stages[i + 1][1]);
        if (gone.length > 0) console.log(`  lost between "${stages[i][0]}" and "${stages[i + 1][0]}": ${gone.length}${gone.slice(0, 8).map(id => `${NL}     [${id}] ${t.news[id]?.title?.slice(0, 90)}`).join('')}`);
    }
    const notClear = [...chosen].filter(id => labels.has(id) && labels.get(id) !== 'CLEAR');
    console.log(`chosen by the AI and judged: ${[...chosen].filter(id => labels.has(id)).length}, of which clear ${[...chosen].filter(id => labels.get(id) === 'CLEAR').length}, maybe ${[...chosen].filter(id => labels.get(id) === 'MAYBE').length}, no ${[...chosen].filter(id => labels.get(id) === 'NO').length}`);
    for (const id of notClear.filter(id => labels.get(id) === 'NO')) console.log(`  chosen but NO: [${id}] ${t.news[id]?.title?.slice(0, 100)}`);
};

// ---- the choice of the AI replayed on the candidates of a trace, with the prompt as it is (v0) and with variants of it, k times each: what each run chooses, how many
// of the stories chosen are of another sport (7-sport-labels.json) and how many are clearly for the reader (labels-*.json)
const choose = async (profile, names, runs = 3) => {
    const t = load(profile);
    const {selectionPrompt, normalizeSelection} = await import('../services/utils/profile-ai.js');
    const {ollamaJson, newUsage} = await import('../services/utils/ollama.js');
    const {PROMPT_VARIANTS} = await import('./funnel-variants.mjs');
    const sports = existsSync(file(profile, 'sport-labels.json')) ? JSON.parse(readFileSync(file(profile, 'sport-labels.json'), 'utf8')) : {};
    const labels = new Map();
    for (let n = 1; n <= 20; n++) {
        const name = file(profile, `labels-${String(n).padStart(2, '0')}.json`);
        if (existsSync(name)) for (const [id, value] of Object.entries(JSON.parse(readFileSync(name, 'utf8')))) labels.set(id, value);
    }
    const usage = newUsage();
    const base = selectionPrompt(t.wanted, t.asked, t.examples, t.interests.map(interest => interest.text), t.week, t.size, t.language);
    const title = (id) => String(t.asked.find(one => one.id === id)?.title).slice(0, 70);
    for (const name of names) {
        const prompt = PROMPT_VARIANTS[name](base, t);
        const results = await Promise.all(Array.from({length: runs}, () => ollamaJson(prompt, usage).then(answer => normalizeSelection(answer, t.asked.map(one => one.id), t.size)).catch(() => null)));
        const kept = results.filter(Boolean);
        const line = kept.map(chosen => {
            const other = chosen.filter(item => String(sports[item.id] ?? '').startsWith('other'));
            const clear = chosen.filter(item => labels.get(item.id) === 'CLEAR');
            return {n: chosen.length, other: other.length, clear: clear.length, otherIds: other.map(item => item.id)};
        });
        console.log(`${name.padEnd(10)} runs ${kept.length}: chosen ${line.map(one => one.n).join('/')} | other sport ${line.map(one => one.other).join('/')} | clear ${line.map(one => one.clear).join('/')}`);
        const others = [...new Set(line.flatMap(one => one.otherIds))];
        for (const id of others) console.log(`     other sport chosen: [${id}] ${title(id)} (${line.filter(one => one.otherIds.includes(id)).length}/${kept.length} runs)`);
        const lost = [...labels].filter(([id, value]) => value === 'CLEAR' && t.asked.some(one => one.id === id)).map(([id]) => id).filter(id => kept.every(chosen => !chosen.some(item => item.id === id)));
        if (lost.length > 0) console.log(`     clear candidates chosen by none of the runs: ${lost.map(id => `[${id}] ${title(id)}`).join(' | ')}`);
    }
    console.log(`tokens ${JSON.stringify(usage)}`);
};

// ---- the same choice with more candidates: the ones of the briefing, then the next stories of the ranking (credible, not shown before, not old... the old gate is
// not replayed) up to 'total', each given as the lead news says it. What the AI chooses of the clear stories with 115, then with more
const wide = async (profile, total = 200, runs = 3) => {
    const t = load(profile);
    const {selectionPrompt, normalizeSelection} = await import('../services/utils/profile-ai.js');
    const {ollamaJson, newUsage} = await import('../services/utils/ollama.js');
    const labels = new Map();
    for (let n = 1; n <= 20; n++) {
        const name = file(profile, `labels-${String(n).padStart(2, '0')}.json`);
        if (existsSync(name)) for (const [id, value] of Object.entries(JSON.parse(readFileSync(name, 'utf8')))) labels.set(id, value);
    }
    const have = new Set(t.asked.map(one => one.id));
    const fresh = new Set(t.fresh);
    const more = t.pool.map(row => row.story).filter(id => fresh.has(id) && !have.has(String(id)) && t.news[id]).slice(0, Math.max(0, total - t.asked.length))
        .map(id => ({id: String(id), title: t.news[id].title, description: t.news[id].description, others: [], trusted: false, media: 1}));
    const usage = newUsage();
    for (const [name, candidates] of [['115 (as built)', t.asked], [`${t.asked.length + more.length}`, [...t.asked, ...more]]]) {
        const prompt = selectionPrompt(t.wanted, candidates, t.examples, t.interests.map(interest => interest.text), t.week, t.size, t.language);
        const results = await Promise.all(Array.from({length: runs}, () => ollamaJson(prompt, usage).then(answer => normalizeSelection(answer, candidates.map(one => one.id), t.size)).catch(() => null)));
        const kept = results.filter(Boolean);
        const clearIn = candidates.filter(one => labels.get(one.id) === 'CLEAR').length;
        console.log(`${name.padEnd(16)} candidates: clear among them ${clearIn} | runs ${kept.length}: chosen ${kept.map(c => c.length).join('/')} | clear chosen ${kept.map(c => c.filter(item => labels.get(item.id) === 'CLEAR').length).join('/')} | no chosen ${kept.map(c => c.filter(item => labels.get(item.id) === 'NO').length).join('/')}`);
    }
    console.log(`tokens ${JSON.stringify(usage)}`);
};

const [command, profile, a, b] = process.argv.slice(2);
if (command === 'wide') await wide(Number(profile), a ? Number(a) : 200, b ? Number(b) : 3);
else if (command === 'choose') await choose(Number(profile), (a ?? 'v0').split(','), b ? Number(b) : 3);
else if (command === 'trace') await trace(Number(profile), a ? Number(a) : 24, b ? Number(b) : 30);
else if (command === 'judge') await judge(Number(profile), a ? Number(a) : 150);
else if (command === 'score') score(Number(profile));
else console.error('trace <profile> [hours] [size] | judge <profile> [beyond] | score <profile>');
await prisma.$disconnect();
process.exit(0);
