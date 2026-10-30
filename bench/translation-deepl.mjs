// DeepL against the AI translation of the briefings, read only (nothing saved in the DB, no production
// code used to write): the texts of saved briefings in another language than the reader's, as the AI
// translated them (gemma4:31b, translatePassages / translateTexts, null when keepsFigures refused it),
// translated again by DeepL into the reader's language. Data in data/translation-deepl/.
//   node --env-file=.env bench/translation-deepl.mjs collect   -> texts.json + volume.json
//       the translated texts of BRIEFINGS (card title, key passages, other angles' titles, denials,
//       official statements), and the source characters of every ready briefing (what DeepL would bill)
//   node --env-file=.env bench/translation-deepl.mjs deepl     -> languages.json, usage-*.json, deepl.json
//       GET /v2/languages + /v2/usage, then POST /v2/translate of every text DeepL covers (DEEPL_API_KEY)
//   node --env-file=.env bench/translation-deepl.mjs tokens    -> tokens.json
//       the AI translation of BRIEFINGS replayed as production asks it (one translatePassages per card,
//       translateTexts per list), only to count its Ollama tokens (the answers are not judged)
//   node bench/translation-deepl.mjs judge [size]              -> judge/packet-<n>.md + judge/key.json
//       per text: the source and the versions (AI, DeepL) shuffled, A/B, the engine hidden
//   node bench/translation-deepl.mjs tally                     -> tally.json
//       the verdicts of judge/verdicts-<n>.json (+ judge/overrides.json, the hand re-reading)
import fs from 'node:fs';
import process from 'node:process';
import pg from 'pg';

const DIR = new URL('./data/translation-deepl/', import.meta.url);
const JUDGE = new URL('judge/', DIR);
fs.mkdirSync(JUDGE, {recursive: true});
const read = (name) => JSON.parse(fs.readFileSync(new URL(name, DIR), 'utf8'));
const write = (name, data) => fs.writeFileSync(new URL(name, DIR), JSON.stringify(data, null, 1));

// the latest of profile 7 (en) and 242 (en), the latest of profile 8 (fr), and older ones of each
const BRIEFINGS = [104, 100, 98, 92, 79, 105, 70];
const what = process.argv[2] ?? 'collect';

const db = async () => {
    const client = new pg.Client({connectionString: process.env.DATABASE_URL});
    await client.connect();
    return client;
};

// the texts of a card a reader of 'reader' got translated (or that the AI refused to translate):
// {kind, from, source, ai}
const textsOfCard = (item, reader) => {
    const out = [];
    const foreign = (language) => language && language !== reader;
    const cardFrom = item.language ?? item.lead?.language;
    if (foreign(item.lead?.language ?? cardFrom) && item.title) {
        out.push({kind: 'title', from: item.lead?.language ?? cardFrom, source: item.title, ai: item.titleTranslation ?? null});
    }
    if (foreign(cardFrom) && item.summary) out.push({kind: 'passages', from: cardFrom, source: item.summary, ai: item.translation ?? null});
    for (const angle of item.angles ?? []) {
        if (foreign(angle.language) && angle.title) out.push({kind: 'angle', from: angle.language, source: angle.title, ai: angle.titleTranslation ?? null});
    }
    for (const denial of item.contested ?? []) {
        if (foreign(denial.language) && denial.sentence) out.push({kind: 'denial', from: denial.language, source: denial.sentence, ai: denial.translation ?? null});
    }
    for (const statement of item.official ?? []) {
        if (foreign(statement.language) && statement.title) out.push({kind: 'official', from: statement.language, source: statement.title, ai: statement.translation ?? null});
    }
    return out;
};

const briefingRows = async (client, where, args = []) => (await client.query(`
    SELECT b.id, b.id_profile, b.created_at, b.items, p.text, p.languages
    FROM briefings b JOIN user_profiles p ON p.id = b.id_profile
    WHERE b.status = 'ready' AND jsonb_typeof(b.items) = 'array' AND ${where}
    ORDER BY b.created_at`, args)).rows;

if (what === 'collect') {
    const {readerLanguage} = await import('../services/utils/language.js');
    const client = await db();
    const texts = [];
    for (const row of await briefingRows(client, 'b.id = ANY($1::int[])', [BRIEFINGS])) {
        const reader = readerLanguage(row);
        row.items.forEach((item, c) => textsOfCard(item, reader).forEach((text, t) => texts.push({
            id: `${row.id}-${c + 1}-${t + 1}`, briefing: row.id, profile: row.id_profile, reader, card: c + 1, ...text,
        })));
    }
    write('texts.json', texts);

    // the characters DeepL would bill per briefing: every foreign text of every ready briefing
    const volume = [];
    for (const row of await briefingRows(client, 'true')) {
        const reader = readerLanguage(row);
        const all = row.items.flatMap(item => textsOfCard(item, reader));
        const byLanguage = {};
        for (const t of all) byLanguage[t.from] = (byLanguage[t.from] ?? 0) + t.source.length;
        volume.push({id: row.id, profile: row.id_profile, at: row.created_at, reader, cards: row.items.length, texts: all.length,
            chars: all.reduce((n, t) => n + t.source.length, 0), passagesChars: all.filter(t => t.kind === 'passages').reduce((n, t) => n + t.source.length, 0),
            aiRefused: all.filter(t => t.ai === null).length, byLanguage});
    }
    write('volume.json', volume);
    await client.end();
    const count = (xs) => Object.entries(xs.reduce((m, x) => ({...m, [x]: (m[x] ?? 0) + 1}), {})).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
    console.log(`${texts.length} texts, ${texts.reduce((n, t) => n + t.source.length, 0)} chars; kinds: ${count(texts.map(t => t.kind))}`);
    console.log(`languages: ${count(texts.map(t => t.from))}`);
    console.log(`AI refused (original shown): ${texts.filter(t => t.ai === null).length}`);
    console.log(`volume: ${volume.length} ready briefings, chars per briefing: ${volume.map(v => v.chars).join(' ')}`);
    process.exit(0);
}

// ---- DeepL ----
const KEY = process.env.DEEPL_API_KEY;
const BASE = KEY?.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
const deepl = async (path, body = null) => {
    const response = await fetch(`${BASE}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {Authorization: `DeepL-Auth-Key ${KEY}`, ...(body ? {'Content-Type': 'application/json'} : {})},
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw new Error(`DeepL ${path}: HTTP ${response.status} ${await response.text()}`);
    return response.json();
};
// a reader's language as a DeepL target, a news' one as a DeepL source
const TARGET = {en: 'EN-US', pt: 'PT-PT', zh: 'ZH-HANS'};
const targetOf = (code) => TARGET[code] ?? code.toUpperCase();
const sourceOf = (code) => ({nb: 'NB', no: 'NB'}[code] ?? code.toUpperCase());

if (what === 'deepl') {
    if (!KEY) throw new Error('DEEPL_API_KEY is missing in server/.env');
    const [sources, targets, before] = await Promise.all([deepl('/v2/languages?type=source'), deepl('/v2/languages?type=target'), deepl('/v2/usage')]);
    write('languages.json', {sources, targets});
    write('usage-before.json', before);
    console.log(`DeepL: ${sources.length} source languages, ${targets.length} target; usage before`, before);
    const covered = new Set(sources.map(l => l.language.toUpperCase()));
    const texts = read('texts.json');
    const done = fs.existsSync(new URL('deepl.json', DIR)) ? read('deepl.json') : {};
    // one request per briefing and source language, 50 texts at most (the API's limit)
    const groups = new Map();
    for (const t of texts) {
        if (done[t.id]) continue;
        if (!covered.has(sourceOf(t.from))) {
            done[t.id] = {uncovered: true};
            continue;
        }
        const key = `${t.reader}|${t.from}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(t);
    }
    for (const [key, list] of groups) {
        for (let i = 0; i < list.length; i += 50) {
            const part = list.slice(i, i + 50);
            const started = Date.now();
            const answer = await deepl('/v2/translate', {
                text: part.map(t => t.source), source_lang: sourceOf(part[0].from), target_lang: targetOf(part[0].reader),
                model_type: 'prefer_quality_optimized', show_billed_characters: true,
            });
            const ms = Date.now() - started;
            part.forEach((t, j) => {
                const tr = answer.translations[j];
                done[t.id] = {text: tr.text, detected: tr.detected_source_language, billed: tr.billed_characters, model: tr.model_type_used, ms};
            });
            write('deepl.json', done);
            console.log(`${key}: ${part.length} texts, ${ms} ms, model ${answer.translations[0]?.model_type_used}`);
        }
    }
    write('usage-after.json', await deepl('/v2/usage'));
    console.log('usage after', read('usage-after.json'));
    process.exit(0);
}

if (what === 'tokens') {
    const {translatePassages, translateTexts, splitSentences} = await import('../services/utils/extract.js');
    const {writtenIn} = await import('../services/utils/language.js');
    const texts = read('texts.json');
    const out = {};
    for (const id of BRIEFINGS) {
        const usage = {calls: 0, input: 0, output: 0};
        const mine = texts.filter(t => t.briefing === id);
        if (mine.length === 0) continue;
        const to = writtenIn(mine[0].reader);
        // the key passages: one call per card, the sentences as stored (paragraphs split again)
        for (const t of mine.filter(t => t.kind === 'passages' && writtenIn(t.from))) {
            const passages = t.source.split(/\n{2,}/).map(p => splitSentences(p).map(text => ({text})));
            await translatePassages(passages.filter(p => p.length), writtenIn(t.from), to, usage).catch(() => null);
        }
        // the short texts: as production, one list per kind (titles of the cards, angles, denials, statements)
        for (const kind of ['title', 'angle', 'denial', 'official']) {
            const list = mine.filter(t => t.kind === kind && writtenIn(t.from));
            for (let i = 0; i < list.length; i += 40) {
                await translateTexts(list.slice(i, i + 40).map(t => ({text: t.source, from: writtenIn(t.from)})), to, usage).catch(() => null);
            }
        }
        out[id] = {...usage, chars: mine.reduce((n, t) => n + t.source.length, 0)};
        console.log(id, out[id]);
        write('tokens.json', out);
    }
    process.exit(0);
}

// ---- blind judging ----
let seed = 20261016;
const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const LANGUAGE = {en: 'English', fr: 'French'};

if (what === 'judge') {
    const size = Number(process.argv[3] ?? 45);
    const texts = read('texts.json');
    const done = read('deepl.json');
    const key = {};
    const items = [];
    for (const t of texts) {
        const versions = [];
        if (t.ai) versions.push(['ai', t.ai]);
        if (done[t.id]?.text) versions.push(['deepl', done[t.id].text]);
        if (versions.length === 0) continue;
        if (versions.length === 2 && random() < 0.5) versions.reverse();
        key[t.id] = Object.fromEntries(versions.map(([engine], i) => ['AB'[i], engine]));
        items.push({t, versions});
    }
    fs.writeFileSync(new URL('key.json', JUDGE), JSON.stringify(key, null, 1));
    const packets = [];
    for (let i = 0; i < items.length; i += size) packets.push(items.slice(i, i + size));
    packets.forEach((part, p) => {
        const body = part.map(({t, versions}) => `### ${t.id} (${t.kind}, ${t.from} -> ${LANGUAGE[t.reader] ?? t.reader})
SOURCE:
${t.source}
${versions.map(([, text], i) => `\nVERSION ${'AB'[i]}:\n${text}`).join('\n')}`).join('\n\n');
        fs.writeFileSync(new URL(`packet-${p + 1}.md`, JUDGE), `# Translation packet ${p + 1} (${part.length} texts)\n\n${body}\n`);
    });
    console.log(`${items.length} texts judged (${items.filter(i => i.versions.length === 2).length} with both versions) in ${packets.length} packets`);
    process.exit(0);
}

if (what === 'tally') {
    const texts = read('texts.json');
    const key = JSON.parse(fs.readFileSync(new URL('key.json', JUDGE), 'utf8'));
    const OVERRIDES = new URL('overrides.json', JUDGE);
    const overrides = fs.existsSync(OVERRIDES) ? JSON.parse(fs.readFileSync(OVERRIDES, 'utf8')) : {};
    const verdicts = {};
    for (const f of fs.readdirSync(JUDGE).filter(f => /^verdicts-\d+\.json$/.test(f))) {
        for (const v of JSON.parse(fs.readFileSync(new URL(f, JUDGE), 'utf8'))) {
            const engine = key[v.id]?.[v.version];
            if (engine) verdicts[`${v.id}|${engine}`] = {...v, engine};
        }
    }
    for (const [k, v] of Object.entries(overrides)) verdicts[k] = {...verdicts[k], ...v};
    const tally = {};
    const add = (engine, kind, verdict) => {
        for (const group of [`${engine}|all`, `${engine}|${kind}`]) {
            tally[group] ??= {texts: 0, errors: 0, minor: 0, byType: {}};
            tally[group].texts += 1;
            if (verdict.severity === 'error') tally[group].errors += 1;
            if (verdict.severity === 'minor') tally[group].minor += 1;
            for (const type of verdict.severity === 'error' ? verdict.types ?? [] : []) tally[group].byType[type] = (tally[group].byType[type] ?? 0) + 1;
        }
    };
    const both = {aiOnly: [], deeplOnly: [], bothErr: [], neither: 0};
    for (const t of texts) {
        const ai = verdicts[`${t.id}|ai`], dl = verdicts[`${t.id}|deepl`];
        if (ai) add('ai', t.kind, ai);
        if (dl) add('deepl', t.kind, dl);
        if (ai && dl) {
            const a = ai.severity === 'error', d = dl.severity === 'error';
            if (a && d) both.bothErr.push(t.id); else if (a) both.aiOnly.push(t.id); else if (d) both.deeplOnly.push(t.id); else both.neither += 1;
        }
        if (!ai && dl) add('deepl-where-ai-refused', t.kind, dl);
    }
    write('tally.json', {tally, both});
    console.log(JSON.stringify({tally, both}, null, 1));
    process.exit(0);
}
