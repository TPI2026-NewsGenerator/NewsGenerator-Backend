// The tally of the analysis bench: node bench/analysis-tally.mjs
//   reads data/analysis/run-*.json (time, tokens, cost), checked-*.json (code checks),
//   judge/key.json + judge/verdicts-<briefing>.json (blind judges) + judge/overrides.json (hand
//   re-read: {lid: {support, forced, useful, inOtherCard, why}}), writes data/analysis/tally.json and
//   prints one row per run and per model.
import fs from 'node:fs';

const DIR = new URL('./data/analysis/', import.meta.url);
const JUDGE = new URL('./judge/', DIR);
const read = (url) => JSON.parse(fs.readFileSync(url, 'utf8'));
const key = read(new URL('key.json', JUDGE));
const overrides = fs.existsSync(new URL('overrides.json', JUDGE)) ? read(new URL('overrides.json', JUDGE)) : {};
const verdicts = {};
const threads = {};
for (const f of fs.readdirSync(JUDGE).filter(f => /^verdicts-\d+\.json$/.test(f))) {
    const v = read(new URL(f, JUDGE));
    threads[v.briefing] = v.thread;
    for (const line of v.lines) verdicts[line.lid] = {...line, ...(overrides[line.lid] ?? {})};
}
for (const [lid, o] of Object.entries(overrides)) if (o.thread) threads[lid] = o.thread;
const missing = Object.keys(key).filter(lid => !verdicts[lid]);
if (missing.length) console.error(`${missing.length} lines without verdict: ${missing.slice(0, 10).join(', ')}`);

// every written line of a run with its verdict
const byRun = {};
for (const [lid, entry] of Object.entries(key)) {
    for (const r of entry.runs) (byRun[r.run] ??= []).push({lid, part: entry.part, briefing: Number(lid.slice(1, lid.indexOf('-'))), ...r, verdict: verdicts[lid]});
}
const runSummaries = Object.fromEntries(fs.readdirSync(DIR).filter(f => /^run-.*\.json$/.test(f) && !f.includes('.try'))
    .map(f => [f.replace(/^run-|\.json$/g, ''), read(new URL(f, DIR)).summary]));

const tallyOf = (lines, summaries) => {
    const kept = lines.filter(l => l.kept);
    const dropped = lines.filter(l => !l.kept);
    const bad = (l) => l.verdict?.support === 'unsupported';
    const part = (p) => kept.filter(l => l.part === p);
    const briefingsOf = [...new Set(lines.map(l => `${l.run}|${l.briefing}`))];
    // a run's system per briefing: empty or not, and whether the judge saw a thread there
    const systems = briefingsOf.map(rb => {
        const [run, b] = rb.split('|');
        const own = kept.filter(l => l.run === run && l.briefing === Number(b) && l.part === 'system');
        return {b: Number(b), shown: own.length > 0, forced: own.some(l => l.verdict?.forced || bad(l)), thread: threads[b]?.exists ?? null};
    });
    const sum = (f) => summaries.reduce((s, x) => s + f(x), 0);
    return {
        runs: summaries.length,
        lines: lines.length, kept: kept.length,
        dropped: {cites: dropped.filter(l => l.reasons[0] === 'cites').length, figures: dropped.filter(l => l.reasons[0] === 'figures').length,
            names: dropped.filter(l => l.reasons[0] === 'names').length},
        droppedRight: dropped.filter(bad).length, droppedWrong: dropped.filter(l => !bad(l)).length,
        unsupportedKept: kept.filter(bad).length,
        unsupportedKeptByPart: Object.fromEntries(['changed', 'system', 'risk'].map(p => [p, part(p).filter(bad).length])),
        unsupportedKeptOtherCard: kept.filter(l => bad(l) && l.verdict?.inOtherCard).length,
        minorKept: kept.filter(l => l.verdict?.support === 'minor').length,
        changed: {kept: part('changed').length, adds: part('changed').filter(l => l.verdict?.useful === 'adds').length},
        system: {kept: part('system').length, forced: part('system').filter(l => l.verdict?.forced).length,
            useful: part('system').filter(l => l.verdict?.useful === true && !l.verdict?.forced && !bad(l)).length,
            shownWhereNoThread: systems.filter(s => s.shown && s.thread === false).length,
            emptyWhereNoThread: systems.filter(s => !s.shown && s.thread === false).length,
            shownWhereThread: systems.filter(s => s.shown && s.thread === true).length,
            emptyWhereThread: systems.filter(s => !s.shown && s.thread === true).length},
        risk: {kept: part('risk').length, unsupported: part('risk').filter(bad).length,
            usefulSupported: part('risk').filter(l => l.verdict?.useful === true && !bad(l)).length},
        secondsPerBriefing: +(sum(s => s.secondsPerBriefing) / summaries.length).toFixed(1),
        maxSeconds: Math.max(...summaries.map(s => s.maxSeconds)),
        tokensPerBriefing: {input: Math.round(sum(s => s.tokensPerBriefing.input) / summaries.length),
            output: Math.round(sum(s => s.tokensPerBriefing.output) / summaries.length)},
        usdPerBriefing: summaries.map(s => s.usdPerBriefing),
    };
};

const out = {perRun: {}, perModel: {}, threads};
for (const [run, lines] of Object.entries(byRun).sort()) out.perRun[run] = tallyOf(lines, [runSummaries[run]]);
const modelOf = (run) => run.replace(/-\d+$/, '');
for (const model of [...new Set(Object.keys(byRun).map(modelOf))]) {
    const runs = Object.keys(byRun).filter(r => modelOf(r) === model);
    out.perModel[model] = tallyOf(runs.flatMap(r => byRun[r]), runs.map(r => runSummaries[r]));
}
fs.writeFileSync(new URL('tally.json', DIR), JSON.stringify(out, null, 1));
for (const [name, t] of [...Object.entries(out.perModel), ...Object.entries(out.perRun)]) {
    console.log(`${name.padEnd(28)} lines ${t.kept}/${t.lines} kept (drop c${t.dropped.cites} f${t.dropped.figures} n${t.dropped.names}; right ${t.droppedRight}, wrong ${t.droppedWrong}) | unsupported kept ${t.unsupportedKept} (ch ${t.unsupportedKeptByPart.changed}, sys ${t.unsupportedKeptByPart.system}, risk ${t.unsupportedKeptByPart.risk}; other card ${t.unsupportedKeptOtherCard}) minor ${t.minorKept} | adds ${t.changed.adds}/${t.changed.kept} | system ${t.system.kept} forced ${t.system.forced} useful ${t.system.useful}, no-thread shown ${t.system.shownWhereNoThread}/empty ${t.system.emptyWhereNoThread}, thread shown ${t.system.shownWhereThread}/empty ${t.system.emptyWhereThread} | risks ${t.risk.kept} unsupported ${t.risk.unsupported} useful ${t.risk.usefulSupported} | ${t.secondsPerBriefing}s (max ${t.maxSeconds.toFixed(0)}) ${t.tokensPerBriefing.input}+${t.tokensPerBriefing.output} tok $${t.usdPerBriefing.join('/')}`);
}
