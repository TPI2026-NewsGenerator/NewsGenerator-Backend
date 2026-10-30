// The language stored for the news (articles.lang) against a second detector, read only (nothing saved
// in the DB, no production file changed). The DeepL bench of 16.10.2026 found the label wrong on 16 of
// 310 foreign texts of 7 briefings: Icelandic stored as no/sv, Portuguese as es/it, and bs/sr/hr mixed.
// The label is the language the AI is told it translates from (writtenIn), so a wrong one can hurt the
// translation. Data in data/language-labels/.
//   node --env-file=.env bench/language-labels.mjs export   -> articles.json, feeds.json, counts.json
//       articles: up to PER_LANGUAGE news of the last 7 days per stored language, at random, with the
//       language of their feed as ingestion reads it (user_feeds, directory_feeds, rss-links, Google
//       search); feeds: every feed with news in the last 7 days, its label and its FEED_TEXTS latest
//       texts; counts: the news of the last 7 days per stored language (to weigh the sample)
//   <venv>/python bench/language-labels.py                    -> lingua.json
//       lingua (pip install lingua-language-detector, 75 languages, Icelandic and bs/hr/sr included,
//       not Galician nor Uzbek) on every text: the second detector
//   node bench/language-labels.mjs replay [franc-all dir]     -> replay.json
//       the language each proposed rule gives the same texts (language.js imported, not changed);
//       franc-all (npm i franc-all, outside the project) for the rule that knows Icelandic
//   node bench/language-labels.mjs tally                      -> tally.json + table.md
//   node --env-file=.env bench/language-labels.mjs overrides  -> overrides.json, mix.json
//       every news of the week whose stored language is not the label of its feed, the label one of the
//       9 the short words know (the words overrode it), up to MAX_OVERRIDES per label; and every news of
//       the week of the MIX_FEEDS busiest feeds whose label lingua contradicts (after tally)
//   <venv>/python bench/language-labels.py extra              -> lingua-extra.json
//   node bench/language-labels.mjs extra-tally [franc-all dir] -> extra.json + extra.md
//   node --env-file=.env bench/language-labels.mjs translate  -> translate.json
//       live: texts whose label is wrong (the DeepL bench's 16, Icelandic, Faroese and Portuguese news
//       of the sample) translated into English by the production functions (translateTexts,
//       translatePassages, gemma4:31b) told the wrong language, then the right one, RUNS times each
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {pathToFileURL} from 'node:url';
import pg from 'pg';

const DIR = new URL('./data/language-labels/', import.meta.url);
fs.mkdirSync(DIR, {recursive: true});
const read = (name) => JSON.parse(fs.readFileSync(new URL(name, DIR), 'utf8'));
const write = (name, data) => fs.writeFileSync(new URL(name, DIR), JSON.stringify(data, null, 1));
const what = process.argv[2] ?? 'export';

const DAYS = 7;
const PER_LANGUAGE = 400;
const FEED_TEXTS = 30;                  // as feedLanguage reads a feed
const TEXT_CHARS = 1000;
const MAX_OVERRIDES = 6000;
const MIX_FEEDS = 12;
const RUNS = 3;
// language.js of 14.10.2026 (Portuguese words, FEED_MARGIN 3) live on the server from this day: the
// overrides are told before and after
const FIX_LIVE = '2026-10-14T22:00:00Z';

// written alike: a reader of one reads the others (mutually intelligible), a mix is not an error
const FAMILY = {bs: 'bs/hr/sr', hr: 'bs/hr/sr', sr: 'bs/hr/sr', me: 'bs/hr/sr', no: 'no', nb: 'no', nn: 'no'};
const family = (code) => FAMILY[code] ?? code;
// languages lingua does not know: its answer says nothing on them
const UNKNOWN_TO_LINGUA = new Set(['gl', 'uz']);

const textOf = (title, description) => `${title ?? ''} ${description ?? ''}`.replace(/\s+/g, ' ').trim().slice(0, TEXT_CHARS);

if (what === 'export') {
    const {rss} = await import('../db/rss-links.js');
    const {languageOfSearch} = await import('../services/utils/google-news.js');
    const shared = new Map(Object.entries(rss).flatMap(([language, categories]) =>
        Object.values(categories).flat().map(url => [url, language])));
    const client = new pg.Client({connectionString: process.env.DATABASE_URL});
    await client.connect();

    // the language of a feed as ingest-service.js embedPending reads it, and where it comes from
    const labelOf = (row) => row.user_language ? {feedLanguage: row.user_language, labelFrom: 'user_feeds'}
        : row.directory_language ? {feedLanguage: row.directory_language, labelFrom: 'directory_feeds'}
        : shared.has(row.feed) ? {feedLanguage: shared.get(row.feed), labelFrom: 'rss-links'}
        : languageOfSearch(row.feed) ? {feedLanguage: languageOfSearch(row.feed), labelFrom: 'google-search'}
        : {feedLanguage: null, labelFrom: 'none'};
    const FEED_LABELS = `
        (SELECT uf.language FROM user_feeds uf WHERE uf.url = f.url AND uf.language IS NOT NULL LIMIT 1) AS user_language,
        (SELECT d.language FROM directory_feeds d WHERE d.url = f.url) AS directory_language`;

    const counts = Object.fromEntries((await client.query(`
        SELECT lang, count(*)::int AS n FROM articles
        WHERE lang IS NOT NULL AND COALESCE(published_at, created_at) >= now() - $1::int * interval '1 day'
        GROUP BY lang ORDER BY n DESC`, [DAYS])).rows.map(row => [row.lang, row.n]));
    write('counts.json', counts);

    const sample = (await client.query(`
        SELECT s.id, s.lang, s.title, s.description, s.link, f.url AS feed, ${FEED_LABELS}
        FROM (SELECT a.*, row_number() OVER (PARTITION BY a.lang ORDER BY md5(a.id::text)) AS r
              FROM articles a
              WHERE a.lang IS NOT NULL AND COALESCE(a.published_at, a.created_at) >= now() - $1::int * interval '1 day') s
        JOIN feeds f ON f.id = s.id_feed
        WHERE s.r <= $2`, [DAYS, PER_LANGUAGE])).rows;
    write('articles.json', sample.map(row => ({
        id: row.id, lang: row.lang, link: row.link, feed: row.feed, ...labelOf(row), text: textOf(row.title, row.description),
    })));

    // every feed with news in the window, its latest texts (as feedLanguage reads a feed)
    const feeds = (await client.query(`
        SELECT f.id, f.url AS feed, ${FEED_LABELS}, x.texts, x.langs, x.news
        FROM feeds f
        JOIN LATERAL (
            SELECT array_agg(t.text ORDER BY t.at DESC) AS texts, array_agg(t.lang ORDER BY t.at DESC) AS langs,
                   (SELECT count(*)::int FROM articles c WHERE c.id_feed = f.id
                      AND COALESCE(c.published_at, c.created_at) >= now() - $1::int * interval '1 day') AS news
            FROM (SELECT concat_ws(' ', a.title, a.description) AS text, a.lang, COALESCE(a.published_at, a.created_at) AS at
                  FROM articles a WHERE a.id_feed = f.id
                  ORDER BY COALESCE(a.published_at, a.created_at) DESC LIMIT $2) t
        ) x ON true
        WHERE x.news > 0`, [DAYS, FEED_TEXTS])).rows;
    write('feeds.json', feeds.map(row => ({
        id: row.id, feed: row.feed, ...labelOf(row), news: row.news,
        texts: row.texts.map(text => text.replace(/\s+/g, ' ').trim().slice(0, TEXT_CHARS)), langs: row.langs,
    })));
    await client.end();
    console.log(`${sample.length} news, ${feeds.length} feeds, ${Object.values(counts).reduce((a, b) => a + b, 0)} news in ${DAYS} days`);
}

if (what === 'replay') {
    const {languageOf, feedLanguage, KNOWN_LANGUAGES, LANGUAGES} = await import('../services/utils/language.js');
    const {franc} = await import('franc');
    // franc-all knows Icelandic (isl) and Faroese (fao), franc (the 187 languages of a million readers) not
    const francAllDir = process.argv[3];
    const {franc: francAll} = francAllDir
        ? await import(pathToFileURL(path.join(francAllDir, 'node_modules/franc-all/index.js')).href) : {franc: null};
    // the codes language.js maps (FRANC_CODES), and Icelandic / Faroese
    const ISO3 = {
        eng: 'en', fra: 'fr', spa: 'es', ita: 'it', deu: 'de', nld: 'nl', por: 'pt', ces: 'cs', pol: 'pl',
        hun: 'hu', ell: 'el', hrv: 'hr', srp: 'sr', bos: 'bs', swe: 'sv', dan: 'da', nob: 'no', nno: 'no', fin: 'fi',
        ron: 'ro', bul: 'bg', rus: 'ru', ukr: 'uk', bel: 'be', tur: 'tr', slk: 'sk', slv: 'sl', ekk: 'et', lvs: 'lv',
        lit: 'lt', kat: 'ka', hye: 'hy', azj: 'az', kaz: 'kk', mkd: 'mk', als: 'sq', heb: 'he', cat: 'ca', glg: 'gl',
        arb: 'ar', pes: 'fa', urd: 'ur', hin: 'hi', ben: 'bn', cmn: 'zh', jpn: 'ja', kor: 'ko', ind: 'id', zlm: 'ms',
        vie: 'vi', tha: 'th', swh: 'sw', afr: 'af', tgl: 'tl', uzn: 'uz',
    };
    const WITH_ICELANDIC = {...ISO3, isl: 'is', fao: 'fo'};
    const ONLY = Object.keys(WITH_ICELANDIC);
    const francAllOf = (text, minLength) => francAll ? (WITH_ICELANDIC[francAll(text, {minLength, only: ONLY})] ?? null) : null;
    // the proposed rule for Icelandic and Faroese: when the label is one the short words do not know
    // (franc told it), franc-all limited to the languages of the project and Icelandic, Faroese decides
    // whether it is one of those two; anything else keeps the label
    const icelandic = (text, told) => {
        if (!told || LANGUAGES.includes(told) || text.length < 200) return told;
        const code = francAllOf(text, 200);
        return code === 'is' || code === 'fo' ? code : told;
    };

    // the same without a dependency: Icelandic writes ð and þ, Faroese ð and ø, no other language of the
    // project does. Share of the letters of a text (measured: the 5 feeds in them 2.4-5.4%, every other
    // feed 0, a Croatian title on "Sigurðsson" 0.7%)
    const ETH = 0.01;
    const lettersOf = (text, told) => {
        const letters = (text.match(/\p{L}/gu) ?? []).length;
        if (!letters || (text.match(/[ðþ]/giu) ?? []).length / letters < ETH) return told;
        return (text.match(/ø/giu) ?? []).length / letters >= ETH / 3 ? 'fo' : 'is';
    };

    const articles = read('articles.json');
    const feeds = read('feeds.json');
    const out = {articles: {}, feeds: {}};
    const feedRule = new Map();
    const feedLetters = new Map();
    for (const f of feeds) {
        const told = feedLanguage(f.texts, f.feed);
        const joined = f.texts.join(' ');
        // the stored label of the feed, and what the rule would make of it
        const relabelled = icelandic(joined, f.feedLanguage);
        feedRule.set(f.feed, relabelled);
        feedLetters.set(f.feed, lettersOf(joined, f.feedLanguage));
        out.feeds[f.id] = {
            current: told,
            icelandic: icelandic(joined, told),
            relabelled,
            letters: lettersOf(joined, told),
            relabelledLetters: lettersOf(joined, f.feedLanguage),
            francTrigrams: ISO3[franc(joined, {minLength: 200})] ?? null,
            francAllTrigrams: francAllOf(joined, 200),
        };
    }
    // the label of a feed kept, no word may override it, for these feed languages
    const keptFor = (languages) => (a) => a.feedLanguage && languages.includes(a.feedLanguage) ? a.feedLanguage : languageOf(a.text, a.feedLanguage);
    const rules = {
        current: (a) => languageOf(a.text, a.feedLanguage),
        icelandic: (a) => languageOf(a.text, feedRule.get(a.feed) ?? a.feedLanguage),
        letters: (a) => languageOf(a.text, feedLetters.get(a.feed) ?? a.feedLanguage),
        'kept:pt': keptFor(['pt']),
        'kept:nl,pt,cs,pl': keptFor(['nl', 'pt', 'cs', 'pl']),
        'kept:all': (a) => a.feedLanguage ?? languageOf(a.text),
        // the proposal: Icelandic and Faroese by their letters, the label of a feed in one of the 4
        // languages no reader reads kept like the labels the short words do not know
        'letters+kept:nl,pt,cs,pl': (a) => {
            const label = feedLetters.get(a.feed) ?? a.feedLanguage;
            return ['nl', 'pt', 'cs', 'pl'].includes(label) ? label : languageOf(a.text, label);
        },
    };
    for (const a of articles) {
        out.articles[a.id] = {
            ...Object.fromEntries(Object.entries(rules).map(([name, rule]) => [name, rule(a)])),
            // a third vote, from the text alone: franc-all limited to the project's languages and Icelandic
            francAll: francAllOf(a.text, 20),
        };
    }
    out.rules = Object.keys(rules);
    out.known = KNOWN_LANGUAGES;
    write('replay.json', out);
    console.log(`${articles.length} news, ${feeds.length} feeds replayed${francAll ? '' : ' (no franc-all: the Icelandic rule is the current one)'}`);
}

if (what === 'tally') {
    const articles = read('articles.json');
    const feeds = read('feeds.json');
    const counts = read('counts.json');
    const lingua = read('lingua.json');
    const replay = read('replay.json');
    const pct = (a, b) => b ? `${(100 * a / b).toFixed(1)}%` : '-';
    const sampled = articles.reduce((m, a) => m.set(a.lang, (m.get(a.lang) ?? 0) + 1), new Map());
    // each news of the sample stands for this many news of the week (the sample is per stored label)
    const weight = (a) => (counts[a.lang] ?? 0) / sampled.get(a.lang);

    // the language of a text: lingua and franc-all (limited to the project's languages, Icelandic and
    // Faroese) agreeing, family-wise. Undecided when they disagree, or lingua is unsure: alone, lingua took
    // Ukrainian for Kazakh and Turkish for Tagalog with full confidence, franc-all errs on short titles
    const truthOf = (a) => {
        const l = lingua.articles[a.id];
        const f = replay.articles[a.id]?.francAll;
        if (!l?.code || l.confidence < 0.5 || !f) return null;
        // lingua has no Faroese: it says Icelandic, franc-all tells them apart
        if (l.code === 'is' && f === 'fo') return 'fo';
        return family(l.code) === family(f) ? l.code : null;
    };

    const perLanguage = {};
    const confusions = {};
    const readerVisible = {};
    for (const a of articles) {
        const row = perLanguage[a.lang] ??= {stored: a.lang, week: counts[a.lang] ?? 0, sample: 0, decided: 0, same: 0, family: 0, other: 0, linguaOther: 0};
        row.sample++;
        const l = lingua.articles[a.id];
        if (l?.code && l.confidence >= 0.5 && family(l.code) !== family(a.lang) && !UNKNOWN_TO_LINGUA.has(a.lang)) row.linguaOther++;
        const truth = truthOf(a);
        if (!truth || UNKNOWN_TO_LINGUA.has(a.lang)) continue;
        row.decided++;
        if (truth === a.lang) row.same++;
        else if (family(truth) === family(a.lang)) row.family++;
        else {
            row.other++;
            const key = `${a.lang} -> ${truth}`;
            confusions[key] ??= {key, sample: 0, week: 0, feeds: {}, examples: []};
            confusions[key].sample++;
            confusions[key].week += weight(a);
            const site = a.feed.replace(/^https?:\/\/(www\.)?/, '').slice(0, 45);
            confusions[key].feeds[site] = (confusions[key].feeds[site] ?? 0) + 1;
            if (confusions[key].examples.length < 5) confusions[key].examples.push({id: a.id, feed: a.feed, feedLanguage: a.feedLanguage, text: a.text.slice(0, 120)});
            // a text in the reader's own language shown as translated from another (en and fr readers)
            if (truth === 'en' || truth === 'fr') readerVisible[truth] = (readerVisible[truth] ?? 0) + weight(a);
        }
    }
    let weekWrong = 0;
    let weekDecided = 0;
    for (const row of Object.values(perLanguage)) {
        row.wrongShare = row.decided ? row.other / row.decided : null;
        row.weekWrong = row.wrongShare === null ? null : Math.round(row.wrongShare * row.week);
        if (row.weekWrong !== null) {
            weekWrong += row.weekWrong;
            weekDecided += row.week;
        }
    }

    // the rules replayed on the same news with today's feed labels, weighted to the week, overall and
    // per label of the feed
    const rules = Object.fromEntries(replay.rules.map(rule => [rule, {right: 0, wrong: 0}]));
    const perFeedLabel = {};
    for (const a of articles) {
        const truth = truthOf(a);
        if (!truth || UNKNOWN_TO_LINGUA.has(a.lang)) continue;
        const w = weight(a);
        const label = a.feedLanguage ?? '(none)';
        const row = perFeedLabel[label] ??= {label, week: 0, ...Object.fromEntries(replay.rules.map(rule => [rule, 0]))};
        row.week += w;
        for (const rule of replay.rules) {
            const told = replay.articles[a.id][rule];
            const right = told && family(told) === family(truth);
            rules[rule][right ? 'right' : 'wrong'] += w;
            if (!right) row[rule] += w;
        }
    }

    // the feeds: their stored label against lingua on their latest texts joined (lingua alone: a long text)
    const feedRows = [];
    const feedRules = {stored: {right: 0, wrong: 0}, relabelled: {right: 0, wrong: 0}, relabelledLetters: {right: 0, wrong: 0}, current: {right: 0, wrong: 0}, icelandic: {right: 0, wrong: 0}, letters: {right: 0, wrong: 0}};
    const trigrams = {same: 0, differ: 0, examples: []};
    for (const f of feeds) {
        const detected = lingua.feeds[f.id];
        const r = replay.feeds[f.id];
        if (r.francTrigrams && r.francAllTrigrams) {
            if (r.francTrigrams === r.francAllTrigrams) trigrams.same++;
            else {
                trigrams.differ++;
                if (trigrams.examples.length < 30) trigrams.examples.push({feed: f.feed, franc: r.francTrigrams, francAll: r.francAllTrigrams, lingua: detected?.code});
            }
        }
        if (!f.feedLanguage || !detected?.code || detected.confidence < 0.5 || UNKNOWN_TO_LINGUA.has(f.feedLanguage)) continue;
        let truth = family(detected.code);
        if (detected.code === 'is' && r.francAllTrigrams === 'fo') truth = 'fo';
        for (const rule of Object.keys(feedRules)) {
            const told = rule === 'stored' ? f.feedLanguage : r[rule];
            feedRules[rule][told && family(told) === truth ? 'right' : 'wrong']++;
        }
        if (family(f.feedLanguage) !== truth) {
            feedRows.push({feed: f.feed, labelFrom: f.labelFrom, label: f.feedLanguage, lingua: truth,
                confidence: Number(detected.confidence.toFixed(2)), news: f.news, relabelled: r.relabelled, replayNow: r.current,
                storedLangs: Object.entries(f.langs.reduce((m, l) => ({...m, [l]: (m[l] ?? 0) + 1}), {})).map(([l, n]) => `${l}:${n}`).join(' ')});
        }
    }
    feedRows.sort((a, b) => b.news - a.news);

    const tally = {perLanguage, confusions, weekWrong, weekDecided, readerVisible, rules, perFeedLabel, feedRules, trigrams, feedRows};
    write('tally.json', tally);

    const round = (x) => Math.round(x);
    const rowsOf = (list) => list.map(cells => `| ${cells.join(' | ')} |`).join('\n');
    const ordered = Object.values(perLanguage).sort((a, b) => b.week - a.week);
    const ruleNames = replay.rules;
    const md = [
        `# Language labels: articles.lang against two detectors (${DAYS} days, read only)`,
        '',
        `Sample: up to ${PER_LANGUAGE} news per stored language (${articles.length}), weighted to the ${Object.values(counts).reduce((a, b) => a + b, 0)} news of the week; `
        + `${feeds.length} feeds with news in the window. A label counts wrong when lingua (confidence >= 0.5) and franc-all `
        + '(limited to the 54 languages of the project, Icelandic and Faroese) agree on another language; undecided when they disagree. '
        + `Labels lingua does not know (${[...UNKNOWN_TO_LINGUA].join(', ')}) left out. bs/hr/sr count as one language (written alike, a reader of one reads the others), no/nb/nn too.`,
        '',
        `**Estimated wrong labels over the week: ${weekWrong} of ${weekDecided} news (${pct(weekWrong, weekDecided)})**, another language than its family. `
        + `Of them, texts in English shown as translated from another language: ~${round(readerVisible.en ?? 0)}/week; in French: ~${round(readerVisible.fr ?? 0)}/week.`,
        '',
        '## Per stored language',
        '',
        '| stored | news/week | sample | decided | same | same family | other | wrong share | ~wrong/week | lingua alone says other |',
        '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
        rowsOf(ordered.map(r => [r.stored, r.week, r.sample, r.decided, r.same, r.family, r.other, pct(r.other, r.decided), r.weekWrong ?? '-', r.linguaOther])),
        '',
        '## Confusions (both detectors agree), weighted to the week',
        '',
        '| stored -> written | sample | ~news/week | feeds (sample) |',
        '|---|---:|---:|---|',
        rowsOf(Object.values(confusions).sort((a, b) => b.week - a.week).map(c => [c.key, c.sample, round(c.week),
            Object.entries(c.feeds).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([s, n]) => `${s} (${n})`).join(', ')])),
        '',
        '## Rules replayed with today\'s feed labels (news per week labelled wrong)',
        '',
        '- current: languageOf(title + description, label of the feed), as ingestion does today',
        '- icelandic: the feeds labelled in a language the short words do not know re-read by franc-all limited to the project\'s languages + Icelandic, Faroese',
        '- letters: Icelandic / Faroese told by the share of ð, þ (and ø) in the latest texts of the feed, no dependency',
        '- kept:pt / kept:nl,pt,cs,pl: no word may override a feed labelled pt (or one of the 4 languages no reader reads)',
        '- kept:all: no word may override any feed label',
        '',
        `| rule | ${ruleNames.join(' | ')} |`,
        `|---|${ruleNames.map(() => '---:').join('|')}|`,
        `| wrong/week | ${ruleNames.map(rule => `${round(rules[rule].wrong)} (${pct(rules[rule].wrong, rules[rule].wrong + rules[rule].right)})`).join(' | ')} |`,
        '',
        'Per label of the feed (labels where a rule changes something, or over 100 wrong/week):',
        '',
        `| feed label | news/week | ${ruleNames.join(' | ')} |`,
        `|---|---:|${ruleNames.map(() => '---:').join('|')}|`,
        rowsOf(Object.values(perFeedLabel).filter(r => new Set(ruleNames.map(rule => round(r[rule]))).size > 1 || r[ruleNames[0]] > 100)
            .sort((a, b) => b.week - a.week).map(r => [r.label, round(r.week), ...ruleNames.map(rule => round(r[rule]))])),
        '',
        '## Feeds',
        '',
        `Labelled feeds lingua contradicts (latest ${FEED_TEXTS} texts joined): stored ${feedRules.stored.wrong} of ${feedRules.stored.right + feedRules.stored.wrong}; `
        + `stored labels re-read by the Icelandic rule ${feedRules.relabelled.wrong}, by the letters ${feedRules.relabelledLetters.wrong}; `
        + `feedLanguage replayed today ${feedRules.current.wrong}, with the Icelandic rule ${feedRules.icelandic.wrong}, with the letters ${feedRules.letters.wrong}. `
        + `franc and franc-all (limited) on the same feeds: same answer ${trigrams.same}, different ${trigrams.differ}.`,
        '',
        '| feed | label from | label | lingua | conf | news/week | Icelandic rule | feedLanguage today | stored langs (latest 30) |',
        '|---|---|---|---|---:|---:|---|---|---|',
        rowsOf(feedRows.slice(0, 40).map(r => [r.feed.slice(0, 70), r.labelFrom, r.label, r.lingua, r.confidence, r.news, r.relabelled, r.replayNow, r.storedLangs])),
        '',
    ].join('\n');
    fs.writeFileSync(new URL('table.md', DIR), md);
    console.log(md);
}

if (what === 'overrides') {
    const {rss} = await import('../db/rss-links.js');
    const {LANGUAGES} = await import('../services/utils/language.js');
    const client = new pg.Client({connectionString: process.env.DATABASE_URL});
    await client.connect();
    // the label as embedPending reads it: user_feeds, then directory_feeds, then rss-links
    const shared = Object.entries(rss).flatMap(([language, categories]) => Object.values(categories).flat().map(url => ({url, language})));
    const rows = (await client.query(`
        WITH labelled AS (
            SELECT f.id, f.url, COALESCE(
                (SELECT uf.language FROM user_feeds uf WHERE uf.url = f.url AND uf.language IS NOT NULL LIMIT 1),
                (SELECT d.language FROM directory_feeds d WHERE d.url = f.url),
                s.language) AS label
            FROM feeds f LEFT JOIN (SELECT unnest($3::text[]) AS url, unnest($4::text[]) AS language) s ON s.url = f.url
        ), overridden AS (
            SELECT a.id, a.lang, a.title, a.description, a.embedded_at, l.url AS feed, l.label,
                   row_number() OVER (PARTITION BY l.label ORDER BY md5(a.id::text)) AS r
            FROM articles a JOIN labelled l ON l.id = a.id_feed
            WHERE COALESCE(a.published_at, a.created_at) >= now() - $1::int * interval '1 day'
              AND a.lang IS NOT NULL AND l.label = ANY($2::text[]) AND a.lang <> l.label
        )
        SELECT *, count(*) OVER (PARTITION BY label)::int AS total FROM overridden`,
        [DAYS, LANGUAGES, shared.map(s => s.url), shared.map(s => s.language)])).rows;
    write('overrides.json', rows.filter(row => row.r <= MAX_OVERRIDES).map(row => ({
        id: row.id, lang: row.lang, label: row.label, feed: row.feed, total: row.total, embeddedAt: row.embedded_at, text: textOf(row.title, row.description),
    })));

    // the busiest feeds whose label lingua contradicts: all their news of the week
    const contradicted = read('tally.json').feedRows.slice(0, MIX_FEEDS);
    const mix = (await client.query(`
        SELECT a.id, a.lang, a.title, a.description, f.url AS feed
        FROM articles a JOIN feeds f ON f.id = a.id_feed
        WHERE f.url = ANY($2::text[]) AND COALESCE(a.published_at, a.created_at) >= now() - $1::int * interval '1 day'`,
        [DAYS, contradicted.map(row => row.feed)])).rows;
    const labels = new Map(contradicted.map(row => [row.feed, row.label]));
    write('mix.json', mix.map(row => ({id: row.id, lang: row.lang, label: labels.get(row.feed), feed: row.feed, text: textOf(row.title, row.description)})));
    await client.end();
    console.log(`${rows.length} news the words overrode, ${mix.length} news of ${contradicted.length} contradicted feeds`);
}

if (what === 'extra-tally') {
    const francAllDir = process.argv[3];
    const {franc: francAll} = await import(pathToFileURL(path.join(francAllDir, 'node_modules/franc-all/index.js')).href);
    const {languageOf} = await import('../services/utils/language.js');
    const ISO3 = {
        eng: 'en', fra: 'fr', spa: 'es', ita: 'it', deu: 'de', nld: 'nl', por: 'pt', ces: 'cs', pol: 'pl',
        hun: 'hu', ell: 'el', hrv: 'hr', srp: 'sr', bos: 'bs', swe: 'sv', dan: 'da', nob: 'no', nno: 'no', fin: 'fi',
        ron: 'ro', bul: 'bg', rus: 'ru', ukr: 'uk', bel: 'be', tur: 'tr', slk: 'sk', slv: 'sl', ekk: 'et', lvs: 'lv',
        lit: 'lt', kat: 'ka', hye: 'hy', azj: 'az', kaz: 'kk', mkd: 'mk', als: 'sq', heb: 'he', cat: 'ca', glg: 'gl',
        arb: 'ar', pes: 'fa', urd: 'ur', hin: 'hi', ben: 'bn', cmn: 'zh', jpn: 'ja', kor: 'ko', ind: 'id', zlm: 'ms',
        vie: 'vi', tha: 'th', swh: 'sw', afr: 'af', tgl: 'tl', uzn: 'uz', isl: 'is', fao: 'fo',
    };
    const only = Object.keys(ISO3);
    const lingua = read('lingua-extra.json');
    const pct = (a, b) => b ? `${(100 * a / b).toFixed(1)}%` : '-';
    // both detectors agreeing, family-wise, as in tally
    const truthOf = (set, row) => {
        const l = lingua[set][row.id];
        const f = ISO3[francAll(row.text, {minLength: 20, only})] ?? null;
        if (!l?.code || l.confidence < 0.5 || !f) return null;
        if (l.code === 'is' && f === 'fo') return 'fo';
        return family(l.code) === family(f) ? l.code : null;
    };

    // the words overriding a feed label: right (the text is in the language they told), or the feed was
    // right, per label; 'total' the news of the week overridden (the sample is capped at MAX_OVERRIDES)
    const overrides = {};
    const live = new Date(FIX_LIVE);
    for (const row of read('overrides.json')) {
        const period = new Date(row.embeddedAt) >= live ? 'after' : 'before';
        const o = overrides[`${row.label}|${period}`] ??= {period, label: row.label, total: row.total, sample: 0, decided: 0, wordsRight: 0, feedRight: 0, neither: 0, byStored: {}, examples: []};
        o.sample++;
        const truth = truthOf('overrides', row);
        if (!truth) continue;
        o.decided++;
        if (family(truth) === family(row.lang)) o.wordsRight++;
        else if (family(truth) === family(row.label)) {
            o.feedRight++;
            o.byStored[row.lang] = (o.byStored[row.lang] ?? 0) + 1;
            if (o.examples.length < 6) o.examples.push({stored: row.lang, feed: row.feed, text: row.text.slice(0, 110)});
        } else o.neither++;
    }

    // the feeds whose label lingua contradicts: what their news are written in
    const mix = {};
    for (const row of read('mix.json')) {
        const m = mix[row.feed] ??= {feed: row.feed, label: row.label, news: 0, decided: 0, stored: {}, written: {}, storedRight: 0, labelRight: 0, noLabelRight: 0};
        m.news++;
        m.stored[row.lang ?? 'null'] = (m.stored[row.lang ?? 'null'] ?? 0) + 1;
        const truth = truthOf('mix', row);
        if (!truth) continue;
        m.decided++;
        m.written[truth] = (m.written[truth] ?? 0) + 1;
        // right as stored, with the label today, and with no label (the words, franc on a long text)
        if (family(row.lang) === family(truth)) m.storedRight++;
        if (family(languageOf(row.text, row.label)) === family(truth)) m.labelRight++;
        if (family(languageOf(row.text)) === family(truth)) m.noLabelRight++;
    }
    const top = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([l, n]) => `${l}:${n}`).join(' ');

    write('extra.json', {overrides, mix});
    const rowsOf = (list) => list.map(cells => `| ${cells.join(' | ')} |`).join('\n');
    const md = [
        `# Words overriding the feed label, and mixed feeds (${DAYS} days)`,
        '',
        `Every news of the week whose stored language is not its feed's label (one of the 9 the short words know), up to ${MAX_OVERRIDES} per label at random; `
        + 'right/wrong when lingua and franc-all agree (family-wise).',
        '',
        `Embedded before / after ${FIX_LIVE} (the language.js of 14.10.2026 live: Portuguese words, FEED_MARGIN 3).`,
        '',
        '| feed label | embedded | overridden/week (all) | sample | decided | words right | feed right | neither | feed right share | stored instead (feed right) |',
        '|---|---|---:|---:|---:|---:|---:|---:|---:|---|',
        rowsOf(Object.values(overrides).sort((a, b) => b.total - a.total || a.period.localeCompare(b.period)).map(o => [o.label, o.period, o.total, o.sample, o.decided,
            o.wordsRight, o.feedRight, o.neither, pct(o.feedRight, o.decided), top(o.byStored)])),
        '',
        '## The busiest feeds whose label lingua contradicts: their news of the week',
        '',
        '| feed | label | news | decided | stored | written (both detectors) | right as stored | with the label today | with no label |',
        '|---|---|---:|---:|---|---|---:|---:|---:|',
        rowsOf(Object.values(mix).sort((a, b) => b.news - a.news).map(m => [m.feed.slice(0, 70), m.label, m.news, m.decided, top(m.stored), top(m.written),
            pct(m.storedRight, m.decided), pct(m.labelRight, m.decided), pct(m.noLabelRight, m.decided)])),
        '',
    ].join('\n');
    fs.writeFileSync(new URL('extra.md', DIR), md);
    console.log(md);
}

if (what === 'translate') {
    const {translateTexts, translatePassages} = await import('../services/utils/extract.js');
    const {languageName} = await import('../services/utils/language.js');
    const {newUsage} = await import('../services/utils/ollama.js');
    const articles = read('articles.json');
    const lingua = read('lingua.json');
    const replay = read('replay.json');

    // the 16 wrong labels of the DeepL bench (the right language as DeepL told it, checked by hand)
    const deepl = JSON.parse(fs.readFileSync(new URL('../translation-deepl/texts.json', DIR), 'utf8'));
    const RIGHT = {'100-16-1': 'is', '100-16-2': 'is', '100-16-3': 'is', '79-2-2': 'pt', '79-3-1': 'pt', '79-3-2': 'pt', '104-6-1': 'pt',
        '98-14-1': 'bs', '100-12-3': 'sr', '104-15-4': 'bs'};
    const texts = deepl.filter(t => RIGHT[t.id]).map(t => ({id: t.id, kind: t.kind, wrong: t.from, right: RIGHT[t.id], source: t.source}));
    // news of the sample: Icelandic and Faroese stored no/sv, Portuguese stored es/it, both detectors agreeing
    const pick = (stored, written, count) => articles.filter(a => stored.includes(a.lang)
            && lingua.articles[a.id]?.code === (written === 'fo' ? 'is' : written) && lingua.articles[a.id].confidence >= 0.9
            && replay.articles[a.id]?.francAll === written)
        .slice(0, count).map(a => ({id: String(a.id), kind: 'news', wrong: a.lang, right: written, source: a.text.slice(0, 400)}));
    texts.push(...pick(['sv', 'no'], 'is', 10), ...pick(['sv', 'no'], 'fo', 5), ...pick(['es', 'it'], 'pt', 8));

    const usage = newUsage();
    const translate = async (text, from) => {
        if (text.kind !== 'passages') return (await translateTexts([{text: text.source, from}], 'English', usage))[0];
        const passages = text.source.split(/\n\s*\n/).filter(Boolean).map(paragraph => [{text: paragraph.trim(), quote: false}]);
        const translated = await translatePassages(passages, from, 'English', usage);
        return translated ? translated.map(passage => passage.map(sentence => sentence.text).join(' ')).join('\n\n') : null;
    };
    const out = [];
    for (const text of texts) {
        const row = {...text, wrongName: languageName(text.wrong), rightName: languageName(text.right), asWrong: [], asRight: []};
        for (let run = 0; run < RUNS; run++) {
            const [asWrong, asRight] = await Promise.all([translate(text, row.wrongName), translate(text, row.rightName)]);
            row.asWrong.push(asWrong);
            row.asRight.push(asRight);
        }
        out.push(row);
        console.log(row.id, row.wrong, '->', row.right, '|', row.asWrong[0]?.slice(0, 70), '||', row.asRight[0]?.slice(0, 70));
    }
    write('translate.json', {usage, texts: out});
    process.exit(0);
}
