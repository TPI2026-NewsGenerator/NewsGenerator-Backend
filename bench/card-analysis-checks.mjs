// The code checks of the per-card analysis bench (no AI), on every data/card-analysis/analysis-*.json:
//   node --env-file=.env bench/card-analysis-checks.mjs
//   writes data/card-analysis/checked-<run>.json and data/card-analysis/checks.json (counts per run)
// The checks of analysis-checks.mjs, against the sources a line CITES (card-analysis-prompt.mjs
// sourcesOf: a cited sentence counts with its article's title and date, a timeline item with its date).
// The text checked is the text shown (ids swapped for the medium, shownText); one tagger name missing
// from the cited articles passes when it is in another source of the card.
// A cited sentence stands for its whole article: failing on the cited sentences alone is counted only.
// A line (one "why" or "next" entry, a next being "if X, then Y") is dropped when
//   1. cites: it cites no source of its card (ids parsed leniently: "A1 s12", "[A1 s12]", "A1 s12-14"),
//   2. figures: one of its figures is in none of its cited sources,
//   3. names: one of the names the NER tagger (Ubuntu :8021) finds in it is in none of its cited sources.
// Each failing figure/name is also looked for in every source of the card: found there = a wrong cite,
// not an invention.
import fs from 'node:fs';
import {nextText, shownText, sourcesOf} from './card-analysis-prompt.mjs';

const DIR = new URL('./data/card-analysis/', import.meta.url);
const TAGGER = process.env.ANALYSIS_NER_URL ?? 'http://192.168.1.135:8021';
const TOKEN = process.env.NER_TOKEN || process.env.EMBEDDER_TOKEN;
const briefings = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('cards.json', DIR), 'utf8')).map(b => [b.id, b]));
const runs = fs.readdirSync(DIR).filter(f => /^analysis-.*\.json$/.test(f) && !f.includes('.try'));

// --- helpers of analysis-checks.mjs, unchanged ---
const NUMBER_WORDS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    fifteen: 15, twenty: 20, thirty: 30, fifty: 50, hundred: 100, thousand: 1000,
    un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12,
    quinze: 15, vingt: 20, trente: 30, cinquante: 50, cent: 100, mille: 1000,
    first: 1, second: 2, third: 3, premier: 1, première: 1, deuxième: 2, troisième: 3,
};
const strip = (text) => (text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
// the figures of a text, digits only, trailing zeros cut: "1.2" -> "12", "1,200,000" -> "12", "20" -> "2"
const figuresOf = (text) => ((text ?? '').match(/\d+(?:[.,   ]\d{3}(?!\d))*(?:[.,]\d+)?/g) ?? [])
    .map(f => f.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '').replace(/0+$/, '') || '0');
// "2 thousand 200", "2 mille 200" are 2200
const spelledThousands = (text) => [...(text ?? '').matchAll(/(\d+)\s+(?:thousand|mille|tysięcy|tysiące|mil)\s+(\d{1,3})\b/gi)]
    .map(m => String(Number(m[1]) * 1000 + Number(m[2])).replace(/0+$/, ''));
// "7 p.m." is also 19 ("19 h"), "2:30 pm" 1430
const afternoonHours = (text) => [...(text ?? '').matchAll(/\b(\d{1,2})(?:[:.](\d{2}))?\s*p\.?\s?m\b/gi)]
    .filter(m => Number(m[1]) < 12).map(m => `${Number(m[1]) + 12}${m[2] ?? ''}`.replace(/0+$/, ''));
// a year of the cards also stands for its last two figures (the season "2020-21" of "2020-2021")
const shortYears = (text) => ((text ?? '').match(/\b(?:19|20)\d{2}\b/g) ?? []).map(y => y.slice(2).replace(/^0(?=\d)/, '').replace(/0+$/, '') || '0');
const cardFigures = (text) => new Set([...figuresOf(text), ...spelledThousands(text), ...afternoonHours(text), ...shortYears(text),
    ...strip(text).split(' ').filter(w => w in NUMBER_WORDS).map(w => String(NUMBER_WORDS[w]).replace(/0+$/, ''))]);

// name: "Université de Houston" = "University of Houston"); a person by their last name alone
const NAME_GLUE = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'of', 'the', 'and', 'et', 'd', 'l', 'von', 'van', 'der', 'di', 'da']);
// a word of the name in capitals (FA, ESA, SIR) is also found as the initials of words of the text
// ("Football Association", "European Space Agency", "Special Illustration Rare")
const holds = (haystack, name, label = '', acronyms = new Set()) => {
    const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
        .map(w => ({w: strip(w), caps: /^\p{Lu}{2,6}$/u.test(w)})).filter(x => x.w.length >= 2 && !NAME_GLUE.has(x.w));
    if (words.length === 0) return true;
    const padded = ` ${haystack} `;
    const has = ({w, caps}) => (caps && acronyms.has(w))
        || (w.length >= 5 ? padded.includes(` ${w.slice(0, 5)}`) : padded.includes(` ${w} `) || padded.includes(` ${w}s `));
    if (padded.includes(` ${words.map(x => x.w).join(' ')} `) || words.every(has)) return true;
    const last = words.at(-1).w;
    return /person/i.test(label) && words.length > 1 && last.length >= 4 && padded.includes(` ${last} `);
};
const acronymsOf = (text) => {
    const tokens = (text ?? '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const out = new Set();
    for (let i = 0; i < tokens.length; i++) {
        let initials = '';
        for (let j = i; j < tokens.length; j++) {
            if (NAME_GLUE.has(tokens[j].toLowerCase()) && initials) continue;
            if (!/^\p{Lu}/u.test(tokens[j])) break;
            initials += strip(tokens[j][0]);
            if (initials.length >= 2) out.add(initials);
        }
    }
    return out;
};
const SENTENCE_START = /(^|[.!?:;→"«“(]\s*)$/;
const STOP = new Set(['if', 'then', 'the', 'a', 'an', 'this', 'that', 'si', 'alors', 'le', 'la', 'les', 'un', 'une', 'ce', 'cette', 'en', 'et', 'de', 'des', 'du', 'au', 'aux', 'il', 'elle', 'ils', 'elles', 'on']);
const capitalised = (text) => {
    const out = [];
    for (const m of text.matchAll(/[\p{Lu}][\p{L}\p{N}'’.-]*(?:\s+(?:de|du|des|la|le|van|von|der|di|da|of|and|&)?\s*[\p{Lu}][\p{L}\p{N}'’.-]*)*/gu)) {
        if (SENTENCE_START.test(text.slice(0, m.index)) && !/\s/.test(m[0])) continue;
        const name = m[0].replace(/[.’'-]+$/, '');
        if (STOP.has(strip(name))) continue;
        out.push(name);
    }
    return out;
};

const tag = async (texts) => {
    const out = [];
    for (let i = 0; i < texts.length; i += 64) {
        const res = await fetch(`${TAGGER}/entities`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', ...(TOKEN ? {Authorization: `Bearer ${TOKEN}`} : {})},
            body: JSON.stringify({texts: texts.slice(i, i + 64)}),
            signal: AbortSignal.timeout(280e3),
        });
        if (!res.ok) throw new Error(`tagger HTTP ${res.status}`);
        out.push(...(await res.json()).entities);
    }
    return out;
};

const NAME_LABELS = /person|organi[sz]ation|location|place|country|city|product|event|team|club|company/i;
// the tagger also tags common nouns ("un utilisateur", "restaurants parisiens", "Several sources"): a
// name has a capitalised word that is no determiner
const DETERMINERS = new Set([...STOP, 'l', 'd', 'several', 'some', 'many', 'most', 'certains', 'certaines', 'plusieurs', 'quelques',
    'ces', 'son', 'sa', 'ses', 'leur', 'leurs', 'their', 'its', 'his', 'her', 'former', 'new', 'nouveau', 'nouvelle']);
// ... and does not end in a common noun ("Spanish referees", "French clubs", "Football federations")
const isName = (entity) => entity.split(/[\s'’-]+/).some(w => /^\p{Lu}/u.test(w) && !DETERMINERS.has(strip(w)))
    && !/^\p{Ll}/u.test(entity.split(/\s+/).at(-1));
// --- end of the helpers ---

const parseCites = (cites) => {
    const ids = [];
    for (const raw of Array.isArray(cites) ? cites : typeof cites === 'string' ? cites.split(/[,;]/) : []) {
        const text = String(raw).replace(/[[\]]/g, '').trim();
        const m = text.match(/^A(\d+)\s*,?\s*s(\d+)(?:\s*[-–]\s*s?(\d+))?$/i);
        if (m) {
            for (let s = Number(m[2]); s <= Number(m[3] ?? m[2]) && s - Number(m[2]) < 30; s++) ids.push(`A${m[1]} s${s}`);
            continue;
        }
        const other = text.match(/^([TGDOW])\s*(\d+)$/i);
        ids.push(other ? `${other[1].toUpperCase()}${other[2]}` : text);
    }
    return [...new Set(ids)];
};
// ids written in the text despite the rule ("(A1 s3, A1 s4)", "A1 says"): counted, and the ones between
// parentheses taken out before the checks (code would take them out before showing the line)
const ID_IN_TEXT = /\b(?:A\d+(?:\s*s\d+)?|[TGDOW]\d+)\b/;
const withoutIds = (text) => text.replace(/\s*\((?:[^()]*\b(?:A\d+|s\d+|[TGDOW]\d+)\b[^()]*)\)/g, '');
const linesOf = (json) => {
    const items = (key) => Array.isArray(json?.[key]) ? json[key] : [];
    return [
        ...items('why').map(l => ({part: 'why', cites: parseCites(l?.cites), raw: String(l?.text ?? '')})),
        ...items('next').map(l => ({part: 'next', cites: parseCites(l?.cites), raw: nextText(l)})),
    ].filter(l => l.raw.replace(/[→\s]/g, '')).map(l => ({...l, idsInText: ID_IN_TEXT.test(l.raw), text: withoutIds(l.raw)}));
};
// the text a cited id stands for: a sentence with its article's title and date, the others with their date
const citedText = (card, sources, id) => {
    const source = sources.get(id);
    if (!source) return null;
    if (source.kind === 'article') {
        const a = card.articles[Number(id.match(/^A(\d+)/)[1]) - 1];
        // the medium too: the lines are asked to say who says what ('according to foot-sur7.fr')
        return `${a.source ?? ''}\n${a.title}\n${String(a.publishedAt ?? '').slice(0, 10)}\n${source.text}`;
    }
    return `${source.date ?? ''}\n${source.text}`;
};

const all = [];
for (const file of runs) {
    const {results} = JSON.parse(fs.readFileSync(new URL(file, DIR), 'utf8'));
    // the text checked is the text shown: ids in the text swapped for the medium (shownText)
    for (const r of results) if (!r.error) for (const line of linesOf(r.json)) {
        all.push({file, briefing: r.briefing, card: r.card, ...line, text: shownText(briefings[r.briefing].cards[r.card - 1], line.raw)});
    }
}
let tagged;
let taggerFailed = null;
const CACHE = new URL('tags.json', DIR);
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
try {
    const unique = [...new Set(all.map(l => l.text))].filter(t => !(t in cache));
    const entities = await tag(unique);
    unique.forEach((t, i) => { cache[t] = entities[i]; });
    fs.writeFileSync(CACHE, JSON.stringify(cache));
    tagged = all.map(l => cache[l.text]);
} catch (err) {
    taggerFailed = err.message;
    console.error(`tagger failed (${err.message}): capitalised words instead`);
}

const checked = all.map((line, i) => {
    const card = briefings[line.briefing].cards[line.card - 1];
    const sources = new Map(sourcesOf(card).map(s => [s.id, s]));
    const valid = line.cites.filter(id => sources.has(id));
    const invalid = line.cites.filter(id => !sources.has(id));
    // a cited sentence stands for its whole article (the name of an actor is often in the sentence
    // before); failing on the cited sentences alone is counted ('strictMissing'), not dropped on
    const citedArticles = new Set(valid.filter(id => id.startsWith('A')).map(id => id.split(' ')[0]));
    const citedIds = [...sources.keys()].filter(id => valid.includes(id) || citedArticles.has(id.split(' ')[0]));
    const cited = citedIds.map(id => citedText(card, sources, id)).join('\n');
    const strictText = valid.map(id => citedText(card, sources, id)).join('\n');
    const every = [...sources.keys()].map(id => citedText(card, sources, id)).join('\n');
    const known = cardFigures(cited), knownEvery = cardFigures(every), knownStrict = cardFigures(strictText);
    const figuresMissing = [...new Set(figuresOf(line.text))].filter(f => !known.has(f));
    const names = taggerFailed ? capitalised(line.text)
        : [...new Map((tagged[i] ?? []).filter(e => NAME_LABELS.test(e.label) && isName(e.text)).map(e => [e.text, e])).values()];
    // a medium named by its own name ('Onze Mondial' for onzemondial.com) is found in its domain
    const media = [...citedArticles].map(id => strip(card.articles[Number(id.slice(1)) - 1]?.source).replace(/ /g, ''));
    const isMedium = (name) => { const w = strip(name).replace(/ /g, ''); return w.length >= 4 && media.some(m => m.includes(w)); };
    const namesMissing = names.filter(n => !holds(strip(cited), n.text ?? n, n.label, acronymsOf(cited)) && !isMedium(n.text ?? n)).map(n => n.text ?? n);
    const strictMissing = [...[...new Set(figuresOf(line.text))].filter(f => !knownStrict.has(f)),
        ...names.filter(n => !holds(strip(strictText), n.text ?? n, n.label, acronymsOf(strictText))).map(n => n.text ?? n)];
    // one name the tagger finds missing from the cited articles passes when it is in some source of the card
    const namesElsewhereHere = namesMissing.filter(n => holds(strip(every), n, '', acronymsOf(every)));
    const nameForgiven = namesMissing.length === 1 && namesElsewhereHere.length === 1;
    const reasons = [valid.length === 0 && 'cites', figuresMissing.length && 'figures', namesMissing.length && !nameForgiven && 'names'].filter(Boolean);
    return {
        ...line, valid, invalid, figuresMissing, names: names.map(n => n.text ?? n), namesMissing, strictMissing,
        // found in a source of the card it does not cite: a wrong cite rather than an invention
        figuresElsewhere: figuresMissing.filter(f => knownEvery.has(f)),
        namesElsewhere: namesElsewhereHere, nameForgiven,
        citeKinds: [...new Set(valid.map(id => sources.get(id).kind))],
        reasons, kept: reasons.length === 0,
    };
});

const counts = {};
for (const line of checked) {
    const c = counts[line.file] ??= {lines: 0, kept: 0, dropped: {cites: 0, figures: 0, names: 0}, failing: {cites: 0, figures: 0, names: 0},
        elsewhere: 0, invalidCites: 0, strictFailing: 0, parts: {why: {lines: 0, kept: 0}, next: {lines: 0, kept: 0}}, citeKinds: {}};
    c.lines++;
    c.parts[line.part].lines++;
    if (line.kept) {
        c.kept++;
        c.parts[line.part].kept++;
    } else {
        c.dropped[line.reasons[0]]++;
        if (line.figuresMissing.length + line.namesMissing.length > 0
            && line.figuresElsewhere.length === line.figuresMissing.length && line.namesElsewhere.length === line.namesMissing.length) c.elsewhere++;
    }
    for (const r of line.reasons) c.failing[r]++;
    if (line.invalid.length) c.invalidCites++;
    if (line.strictMissing.length) c.strictFailing++;
    if (line.idsInText) c.idsInText = (c.idsInText ?? 0) + 1;
    for (const k of line.citeKinds) c.citeKinds[k] = (c.citeKinds[k] ?? 0) + 1;
}
for (const file of runs) {
    fs.writeFileSync(new URL(file.replace(/^analysis-/, 'checked-'), DIR), JSON.stringify(checked.filter(l => l.file === file), null, 1));
}
fs.writeFileSync(new URL('checks.json', DIR), JSON.stringify({taggerFailed, counts}, null, 1));
for (const [file, c] of Object.entries(counts)) {
    console.log(`${file}: ${c.kept}/${c.lines} kept (why ${c.parts.why.kept}/${c.parts.why.lines}, next ${c.parts.next.kept}/${c.parts.next.lines}); dropped cites ${c.dropped.cites}, figures ${c.dropped.figures}, names ${c.dropped.names} (${c.elsewhere} found in an uncited source); lines with an unknown id ${c.invalidCites}; failing on the cited sentences alone ${c.strictFailing}; ids in the text ${c.idsInText ?? 0}; cited kinds ${JSON.stringify(c.citeKinds)}`);
}
for (const l of checked.filter(l => !l.kept)) console.log(`  DROP ${l.file.replace(/^analysis-|\.json$/g, '')} ${l.briefing}-${l.card} ${l.part} [${l.cites}] ${l.reasons.join('+')} fig:${l.figuresMissing} names:${l.namesMissing}${l.figuresElsewhere.length + l.namesElsewhere.length ? ` (elsewhere: ${[...l.figuresElsewhere, ...l.namesElsewhere]})` : ''} | ${l.text.slice(0, 150)}`);
