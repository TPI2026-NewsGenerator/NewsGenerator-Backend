// The verdicts of the judges on formats-models-judge.mjs packets, per model:
// node bench/formats-models-tally.mjs <dir>   reads <dir>/verdicts-*.json, <dir>/key.json and
//   <dir>/overrides.json (the hand re-read: [{article, output, item, severity, why}], severity "none"
//   takes an error back, any other sets it or adds it), writes <dir>/tally.json and prints the table.
// An article counts once per run and format when one of its statements has a MAJOR error. Grounded: the
// errors left after the check by gemma4:31b, i.e. the MAJOR statements the check found supported (the
// others were replaced by a published sentence); also how many statements the check replaced that had
// no error at all.
import fs from 'node:fs';
import path from 'node:path';

const [dir] = process.argv.slice(2);
const MODELS = ['gemma4:31b', 'deepseek-v4-pro:0813', 'kimi-k3', 'mistral-large-3:675b', 'deepseek-v4.1-flash'];
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const key = read(path.join(dir, 'key.json'));
const overridesFile = path.join(dir, 'overrides.json');
const overrides = fs.existsSync(overridesFile) ? read(overridesFile) : [];
const verdicts = fs.readdirSync(dir).filter(f => /^verdicts-\d+\.json$/.test(f)).flatMap(f => read(path.join(dir, f)));
const results = Object.fromEntries(MODELS.map(m => [m, [1, 2].map(run =>
    read(new URL(`./data/faithful/models-${m.replace(/[:.]/g, '-')}-${run}.json`, import.meta.url)))]));

// the errors of an output after the hand re-read
const errorsOf = (v) => {
    const errors = (v.errors ?? []).map(e => ({...e}));
    for (const o of overrides.filter(o => o.article === v.article && o.output === v.output)) {
        const found = errors.find(e => e.item === o.item);
        if (found) found.severity = o.severity;
        else if (o.severity !== 'none') errors.push({item: o.item, severity: o.severity, quote: o.quote ?? '', why: o.why ?? ''});
    }
    return errors.filter(e => e.severity !== 'none');
};

const table = {};
for (const m of MODELS) {
    table[m] = {};
    for (const kind of ['P', 'S']) for (const run of [1, 2]) {
        const name = `${kind === 'P' ? 'points' : 'summary'}${run}`;
        const rows = verdicts.filter(v => key[v.article] && key[v.article][v.output.split('-')[0]] === m && v.output.endsWith(`-${kind}${run}`));
        const major = [], left = [], borderline = [], minor = [];
        let replaced = 0, replacedClean = 0, statements = 0, caught = 0, majors = 0;
        for (const v of rows) {
            const r = results[m][run - 1].results.find(x => x.id === v.article);
            const check = kind === 'P' ? r.pointsCheck : r.summaryCheck;
            const errors = errorsOf(v);
            const majorItems = errors.filter(e => e.severity === 'MAJOR').map(e => e.item);
            if (majorItems.length) major.push(v.article);
            if (majorItems.some(item => check[item - 1]?.supported)) left.push(v.article);
            if (errors.some(e => e.severity === 'borderline')) borderline.push(v.article);
            if (errors.some(e => e.severity === 'minor')) minor.push(v.article);
            statements += check.length;
            check.forEach((c, i) => {
                if (c.supported) return;
                replaced++;
                if (!errors.some(e => e.item === i + 1)) replacedClean++;
            });
            majors += majorItems.length;
            caught += majorItems.filter(item => check[item - 1] && !check[item - 1].supported).length;
        }
        table[m][name] = {
            judged: rows.length, major, borderline, minor,
            mainNewsMissed: rows.filter(v => v.mainNewsMissed).map(v => v.article),
            unclearRef: rows.filter(v => v.unclearRef).map(v => v.article),
            grounded: {left, majorStatements: majors, caught, replaced: `${replaced}/${statements}`, replacedWithoutError: replacedClean},
        };
    }
}
fs.writeFileSync(path.join(dir, 'tally.json'), JSON.stringify(table, null, 1));

const cell = (t) => `${t.major.length}`;
console.log('model | points err r1/r2 | summary err r1/r2 | points after check | summary after check | main missed P/S | unclear P/S | replaced P / S (no error)');
for (const m of MODELS) {
    const t = table[m];
    console.log([m,
        `${cell(t.points1)}/${cell(t.points2)}`, `${cell(t.summary1)}/${cell(t.summary2)}`,
        `${t.points1.grounded.left.length}/${t.points2.grounded.left.length}`, `${t.summary1.grounded.left.length}/${t.summary2.grounded.left.length}`,
        `${t.points1.mainNewsMissed.length + t.points2.mainNewsMissed.length}/${t.summary1.mainNewsMissed.length + t.summary2.mainNewsMissed.length} (2 runs)`,
        `${t.points1.unclearRef.length + t.points2.unclearRef.length}/${t.summary1.unclearRef.length + t.summary2.unclearRef.length} (2 runs)`,
        `${t.points1.grounded.replaced}+${t.points2.grounded.replaced} (${t.points1.grounded.replacedWithoutError + t.points2.grounded.replacedWithoutError}) / ${t.summary1.grounded.replaced}+${t.summary2.grounded.replaced} (${t.summary1.grounded.replacedWithoutError + t.summary2.grounded.replacedWithoutError})`,
    ].join(' | '));
    for (const name of ['points1', 'points2', 'summary1', 'summary2']) {
        console.log(`   ${name}: MAJOR ${t[name].major.join(' ') || '-'}; left after check ${t[name].grounded.left.join(' ') || '-'}; borderline ${t[name].borderline.join(' ') || '-'}`);
    }
}
