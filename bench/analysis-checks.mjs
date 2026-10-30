// The code checks of the analysis bench (no AI), on every data/analysis/run-*.json:
//   node --env-file=.env bench/analysis-checks.mjs
//   writes data/analysis/checked-<run>.json and data/analysis/checks.json (counts per run)
// A line (one "changed", "system" or "risk" entry; a risk is "if X, then Y") is dropped when
//   1. cites: it cites no card of the briefing (a system: fewer than 3 different cards),
//   2. figures: one of its figures is in none of its cited cards (separators and trailing zeros
//      ignored: "1.2 million" = "1,200,000" = "1 200 000"; number words of the cards count as figures),
//   3. names: one of the names the NER tagger (Ubuntu :8021, GLiNER) finds in it is in none of its
//      cited cards (accents, case, punctuation ignored; every word of the name found is enough).
//      The tagger not answering: capitalised words not starting a sentence, the same way.
// A cited card = its title, translated title, key passages and their translation, as the AI read them.
// Each check runs on every line (a line can fail several); 'dropped' counts the first failing check.
// The capitalised-word check runs on every line too, to compare it with the tagger.
import fs from 'node:fs';

const DIR = new URL('./data/analysis/', import.meta.url);
const TAGGER = process.env.ANALYSIS_NER_URL ?? 'http://192.168.1.135:8021';
const TOKEN = process.env.NER_TOKEN || process.env.EMBEDDER_TOKEN;
const briefings = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('briefings.json', DIR), 'utf8')).map(b => [b.id, b]));
const runs = fs.readdirSync(DIR).filter(f => /^run-.*\.json$/.test(f) && !f.includes('.try'));

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

const cardText = (card) => [card.title, card.titleTranslation, card.passages, card.translation].filter(Boolean).join('\n');
const linesOf = (json) => {
    const cards = (list) => (Array.isArray(list) ? list : []).map(Number).filter(Number.isInteger);
    const items = (key) => Array.isArray(json?.[key]) ? json[key] : [];
    return [
        ...items('changed').map(l => ({part: 'changed', cards: cards(l?.cards), text: String(l?.text ?? '')})),
        ...items('system').map(l => ({part: 'system', cards: cards(l?.cards), text: String(l?.text ?? '')})),
        ...items('risks').map(l => ({part: 'risk', cards: cards(l?.cards), text: `${l?.if ?? ''} → ${l?.then ?? ''}`})),
    ].filter(l => l.text.replace(/[→\s]/g, ''));
};

// a name is found in a text when the text holds it, or every word of it (of 2 letters or more)
// a name is found in a text when the text holds it, or every word of it (of 2 letters or more, the
// small words of names left aside), a word of 5 letters or more by its first 5 letters (a translated
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

// every line of every run, tagged once
const all = [];
for (const file of runs) {
    const {results} = JSON.parse(fs.readFileSync(new URL(file, DIR), 'utf8'));
    for (const r of results) if (!r.error) for (const line of linesOf(r.json)) all.push({file, id: r.id, ...line});
}
let tagged;
let taggerFailed = null;
// the tagger's answers kept in data/analysis/tags.json (text -> names), a text tagged once
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

const NAME_LABELS = /person|organi[sz]ation|location|place|country|city|product|event|team|club|company/i;
// the tagger also tags common nouns ("un utilisateur", "restaurants parisiens", "Several sources"): a
// name has a capitalised word that is no determiner
const DETERMINERS = new Set([...STOP, 'l', 'd', 'several', 'some', 'many', 'most', 'certains', 'certaines', 'plusieurs', 'quelques',
    'ces', 'son', 'sa', 'ses', 'leur', 'leurs', 'their', 'its', 'his', 'her', 'former', 'new', 'nouveau', 'nouvelle']);
// ... and does not end in a common noun ("Spanish referees", "French clubs", "Football federations")
const isName = (entity) => entity.split(/[\s'’-]+/).some(w => /^\p{Lu}/u.test(w) && !DETERMINERS.has(strip(w)))
    && !/^\p{Ll}/u.test(entity.split(/\s+/).at(-1));
const checked = all.map((line, i) => {
    const briefing = briefings[line.id];
    const valid = [...new Set(line.cards.filter(n => briefing.cards[n - 1]))];
    const cited = valid.map(n => cardText(briefing.cards[n - 1])).join('\n');
    const citedStrip = strip(cited);
    const everyStrip = strip(briefing.cards.map(cardText).join('\n'));
    const cites = line.part === 'system' ? valid.length >= 3 : valid.length >= 1;
    const known = cardFigures(cited);
    const figuresMissing = [...new Set(figuresOf(line.text))].filter(f => !known.has(f));
    const names = taggerFailed ? capitalised(line.text)
        : [...new Map((tagged[i] ?? []).filter(e => NAME_LABELS.test(e.label) && isName(e.text)).map(e => [e.text, e])).values()];
    const namesMissing = names.filter(n => !holds(citedStrip, n.text ?? n, n.label, acronymsOf(cited))).map(n => n.text ?? n);
    const capsMissing = [...new Set(capitalised(line.text))].filter(n => !holds(citedStrip, n, '', acronymsOf(cited)));
    const reasons = [!cites && 'cites', figuresMissing.length && 'figures', namesMissing.length && 'names'].filter(Boolean);
    return {
        ...line, valid, cites, figuresMissing, names: names.map(n => n.text ?? n), namesMissing,
        namesInOtherCards: namesMissing.filter(n => holds(everyStrip, n, '', acronymsOf(briefing.cards.map(cardText).join('\n')))),
        capsMissing, reasons, kept: reasons.length === 0,
    };
});

const counts = {};
for (const line of checked) {
    const c = counts[line.file] ??= {lines: 0, kept: 0, dropped: {cites: 0, figures: 0, names: 0}, failing: {cites: 0, figures: 0, names: 0, caps: 0},
        parts: {changed: {lines: 0, kept: 0}, system: {lines: 0, kept: 0}, risk: {lines: 0, kept: 0}}};
    c.lines++;
    c.parts[line.part].lines++;
    if (line.kept) {
        c.kept++;
        c.parts[line.part].kept++;
    } else c.dropped[line.reasons[0]]++;
    for (const r of line.reasons) c.failing[r]++;
    if (line.capsMissing.length) c.failing.caps++;
}
for (const file of runs) {
    const lines = checked.filter(l => l.file === file);
    fs.writeFileSync(new URL(file.replace(/^run-/, 'checked-'), DIR), JSON.stringify(lines, null, 1));
}
fs.writeFileSync(new URL('checks.json', DIR), JSON.stringify({taggerFailed, counts}, null, 1));
for (const [file, c] of Object.entries(counts)) {
    console.log(`${file}: ${c.kept}/${c.lines} kept; dropped cites ${c.dropped.cites}, figures ${c.dropped.figures}, names ${c.dropped.names}; failing caps ${c.failing.caps}; system ${c.parts.system.kept}/${c.parts.system.lines}, risks ${c.parts.risk.kept}/${c.parts.risk.lines}`);
}
for (const l of checked.filter(l => !l.kept)) console.log(`  DROP ${l.file.replace(/^run-|\.json$/g, '')} b${l.id} ${l.part} [${l.cards}] ${l.reasons.join('+')} fig:${l.figuresMissing} names:${l.namesMissing}${l.namesInOtherCards.length ? ` (other card: ${l.namesInOtherCards})` : ''} | ${l.text.slice(0, 150)}`);
