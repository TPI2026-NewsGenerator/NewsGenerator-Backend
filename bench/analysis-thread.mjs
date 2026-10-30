// Would a code rule catch the forced "Why this matters" lines? node --env-file=.env bench/analysis-thread.mjs
//   The names of each card (NER tagger on its title + passages, as analysis-checks.mjs), then for each
//   "system" line kept by the checks: does a name appear in at least 3 of the cards it cites? Compared
//   with the judges' verdict (forced or unsupported = a bad system). Writes data/analysis/thread-rule.json.
import fs from 'node:fs';

const DIR = new URL('./data/analysis/', import.meta.url);
const JUDGE = new URL('./judge/', DIR);
const TAGGER = process.env.ANALYSIS_NER_URL ?? 'http://192.168.1.135:8021';
const TOKEN = process.env.NER_TOKEN || process.env.EMBEDDER_TOKEN;
const read = (url) => JSON.parse(fs.readFileSync(url, 'utf8'));
const briefings = read(new URL('briefings.json', DIR));
const key = read(new URL('key.json', JUDGE));
const overrides = read(new URL('overrides.json', JUDGE));
const verdicts = {};
const threads = {};
for (const f of fs.readdirSync(JUDGE).filter(f => /^verdicts-\d+\.json$/.test(f))) {
    const v = read(new URL(f, JUDGE));
    threads[v.briefing] = v.thread;
    for (const l of v.lines) verdicts[l.lid] = {...l, ...(overrides[l.lid] ?? {})};
}
const strip = (text) => (text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// the names of each card, tagged once (title, translated title, first 1500 characters of passages)
const CACHE = new URL('card-names.json', DIR);
const names = fs.existsSync(CACHE) ? read(CACHE) : {};
const todo = briefings.flatMap(b => b.cards.map(c => ({k: `${b.id}-${c.n}`, text: [c.titleTranslation ?? c.title, (c.translation ?? c.passages).slice(0, 1500)].join('\n')})))
    .filter(t => !(t.k in names));
for (let i = 0; i < todo.length; i += 32) {
    const part = todo.slice(i, i + 32);
    const res = await fetch(`${TAGGER}/entities`, {method: 'POST', signal: AbortSignal.timeout(280e3),
        headers: {'Content-Type': 'application/json', ...(TOKEN ? {Authorization: `Bearer ${TOKEN}`} : {})},
        body: JSON.stringify({texts: part.map(t => t.text)})});
    const {entities} = await res.json();
    part.forEach((t, j) => { names[t.k] = [...new Set(entities[j].filter(e => /person|organi|location|product|event/i.test(e.label) && /\p{Lu}/u.test(e.text)).map(e => strip(e.text)))]; });
}
fs.writeFileSync(CACHE, JSON.stringify(names));

// a name shared by 3 cited cards: the same name, or one name inside the other ("infantino" in "gianni infantino")
const shares = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (` ${b} `.includes(` ${a} `) || ` ${a} `.includes(` ${b} `)));
const sharedName = (id, cards) => {
    const lists = cards.map(n => names[`${id}-${n}`] ?? []);
    for (const name of new Set(lists.flat())) {
        if (lists.filter(list => list.some(other => shares(name, other))).length >= 3) return name;
    }
    return null;
};

const rows = [];
for (const [lid, entry] of Object.entries(key)) {
    if (entry.part !== 'system' || !entry.runs.some(r => r.kept)) continue;
    const id = Number(lid.slice(1, lid.indexOf('-')));
    const v = verdicts[lid];
    const bad = v.forced === true || v.support === 'unsupported';
    rows.push({lid, id, cards: entry.cards, runs: entry.runs.filter(r => r.kept).map(r => r.run), bad, shared: sharedName(id, entry.cards), thread: threads[id]?.exists, text: entry.text.slice(0, 160)});
}
const kept = rows.filter(r => r.shared);
const count = (list, f) => list.filter(f).length;
const out = {
    systemLines: rows.length, bad: count(rows, r => r.bad),
    rule: {kept: kept.length, keptBad: count(kept, r => r.bad), dropped: rows.length - kept.length, droppedGood: count(rows, r => !r.shared && !r.bad)},
    noThreadBriefings: {lines: count(rows, r => r.thread === false), keptByRule: count(rows, r => r.thread === false && r.shared)},
    rows,
};
fs.writeFileSync(new URL('thread-rule.json', DIR), JSON.stringify(out, null, 1));
console.log(JSON.stringify({...out, rows: undefined}, null, 1));
for (const r of rows) console.log(`${r.bad ? 'BAD ' : 'good'} ${r.shared ? `KEEP(${r.shared})` : 'DROP'} b${r.id} thread:${r.thread} [${r.cards}] ${r.runs.map(x => x.replace(/-0813|-none|-k3/g, '')).join(',')} | ${r.text}`);
