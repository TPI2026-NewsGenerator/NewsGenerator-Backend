//
//  Author: Fabian Rostello
//  Date: 23.09.2026
//  File: compare-grouping.js
//  Description: Bench comparing the ways of deciding that two articles tell the same news, on
//               pairs read and judged by hand, then on real searches
//               usage: node scripts/compare-grouping.js [--days 3]
//

"use strict"

import 'dotenv/config';
import process from 'node:process';
import {FeedModel} from '../models/feed-model.js';
import {Filter} from '../services/utils/filter.js';
import Links from '../services/utils/links.js';
import {prisma} from '../config/db.js';

const days = Number(process.argv[process.argv.indexOf('--days') + 1]) || 3;

// ---------------------------------------------------------------------------------------------
// What a right answer looks like. Every article is named by a piece of its title, read and judged
// by hand in the searches of the last days. A measure is only worth something if one threshold
// catches all of the first list and none of the second.
//
// SAME: the same event. Different papers, different words, one fact.
// APART: the hard negatives — they look alike and are not the same news. A template its paper puts
// around unrelated matches, a daily market report, a subject followed over days.
// ---------------------------------------------------------------------------------------------
const SAME = {
    // English
    higuain: ['Columbus Crew sack coach Federico Higua', 'brother sacked by MLS club',
        'MLS coach sacked after sexist remark', 'Columbus Crew reserve team coach fired',
        'Crew 2 fires Higuain after fallout'],
    realMadrid: ['Real Madrid referee row rages on', 'Furious Real Madrid turn on',
        'Real Madrid call for La Liga president'],
    merz: ['Merz Pledges to Stay On', 'Merz Vows to Stay After Another'],
    mamdani: ['Netanyahu accuses Mamdani', 'Netanyahu Attacks Mamdani', 'Netanyahu says of Mamdani',
        'Netanyahu Falsely Accuses Mamdani'],
    irelandIsrael: ['Ireland manager responds to Israel criticism', 'Israel accuse Ireland manager',
        "Israel's FA accuse Ireland manager", "Hallgrimsson accused of 'ignorance",
        "Israel FA accuses Hallgrimsson"],
    // Spanish
    zapatero: ['Zapatero sostiene que Arabia Saud', 'Zapatero asegura que las joyas',
        'Zapatero alega ante el juez', 'Zapatero asegura al juez que las joyas'],
    querola: ['Así era La Querola', 'El fuego destruye La Querola', 'Un incendio destruye la lujosa'],
    // French
    hakimi: ['Achraf Hakimi sera jug', 'Affaire Hakimi : un proc', 'Cour de cassation confirme le renvoi',
        "Cour de cassation rejette le pourvoi d'Achraf", 'Débouté par la Cour de cassation',
        'la Cour de cassation a tranché'],
    brun: ['Philippe Brun ne sera pas r', 'justice rejette la demande de r',
        'Écarté de la primaire de la gauche', 'ne pourra réintégrer'],
    // Italian
    ocse: ['Ocse rivede al rialzo la crescita', 'Ocse rivede al rialzo stime pil',
        'Ocse rivede al rialzo le stime del pil'],
};
const APART = {
    bettingTips: ['Egypt vs Angola Prediction', 'Togo vs Burundi Prediction',
        'Sudan vs Ethiopia Prediction', 'UAE vs Yemen Prediction'],
    ipbl: ['3 interesting facts about Mihika', '3 interesting facts about Armaan',
        '3 interesting facts about Harsh'],
    borsa: ['Borsa: Milano chiude in calo', 'La Borsa di Milano apre in rialzo',
        "Borsa: l'Europa rallenta malgrado"],
    howToWatch: ['How to Watch Nebraska vs. Missouri', 'South Africa vs Australia ODIs, live streaming'],
    // one subject, several days, several events: the card must not call this one news
    unAssembly: ['U.N. General Assembly Traffic and Street Closures', "Trump Threatens Iran’s ‘Annihilation’",
        'Macron to Make His Final U.N. General Assembly'],
    marketTalk: ['Health Care Roundup: Market Talk', 'Auto & Transport Roundup: Market Talk'],
};

// ---------------------------------------------------------------------------------------------
// The measures
// ---------------------------------------------------------------------------------------------
const strip = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const tokens = (title) => [...new Set(strip(title).split(/[^a-z0-9]+/).filter(word => word.length > 1))];

// what the code does today: trigrams of the whole title, accents removed
const trigrams = (title) => {
    const padded = ` ${strip(title).replace(/[^a-z0-9]+/g, ' ').trim()} `;
    const set = new Set();
    for (const word of padded.split(' ').filter(Boolean)) {
        const w = `  ${word} `;
        for (let i = 0; i < w.length - 2; i++) set.add(w.slice(i, i + 3));
    }
    return set;
};

const jaccard = (a, b) => {
    let shared = 0;
    for (const item of a) if (b.has(item)) shared++;
    return shared / (a.size + b.size - shared);
};

// a word in many articles names a subject, a word in few names an event: weigh them apart
const cosineIdf = (a, b, idf) => {
    const weight = (words) => words.reduce((sum, word) => sum + (idf.get(word) ?? 0) ** 2, 0);
    const shared = a.filter(word => b.includes(word)).reduce((sum, word) => sum + (idf.get(word) ?? 0) ** 2, 0);
    const norm = Math.sqrt(weight(a)) * Math.sqrt(weight(b));
    return norm === 0 ? 0 : shared / norm;
};

// IDF weighs a word by how rare it is, and that is not the same as identifying an event: "Betting
// Tips" is rare in the whole corpus because one site alone writes it, so IDF hands it a high weight
// and joins eight unrelated matches. A word that names an event is written by SEVERAL media; a word
// that only ever appears under one masthead is that paper's furniture. So the weight is kept only
// for the words at least two media use.
const cosineShared = (a, b, idf, media) => {
    const kept = (words) => words.filter(word => (media.get(word) ?? 0) > 1);
    return cosineIdf(kept(a), kept(b), idf);
};

// ---------------------------------------------------------------------------------------------
// Embeddings: the only measure here that does not count shared text. "Columbus Crew" and "MLS
// club" share no trigram and no word, but a model that has read enough puts them close. Run by the
// Ollama already installed on this machine, so it costs nothing but the time of the first read of
// each title: a title is embedded once and kept.
// ---------------------------------------------------------------------------------------------
const OLLAMA = process.env.OLLAMA_HOST || 'http://localhost:11434';
const vectors = new Map();      // title -> vector, so the bench embeds each title only once

const embedAll = async (titles, model) => {
    const missing = titles.filter(title => !vectors.has(`${model}\u0000${title}`));
    for (let i = 0; i < missing.length; i += 64) {
        const batch = missing.slice(i, i + 64);
        const answer = await fetch(`${OLLAMA}/api/embed`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({model, input: batch}),
        });
        if (!answer.ok) throw new Error(`${model}: ${answer.status} ${await answer.text()}`);

        const {embeddings} = await answer.json();
        batch.forEach((title, j) => vectors.set(`${model}\u0000${title}`, embeddings[j]));
    }
};

const cosine = (a, b) => {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
};

const embedding = (model) => ({
    embed: model,
    prepare: (title) => vectors.get(`${model}\u0000${title}`),
    score: (a, b) => (a && b ? cosine(a, b) : 0),
    sweep: [0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.60, 0.70, 0.80, 0.90],
});

// The two measures fail on opposite cases: trigrams miss a paraphrase (0.263 between the Guardian
// and the BBC on Higuain), embeddings blur the entities (0.829 between two unrelated matches under
// the same betting template). Each score is divided by its own threshold, so 1.0 means "at the bar",
// and the two are then combined: the maximum groups when EITHER agrees, the minimum when BOTH do.
const TRIGRAM_BAR = 0.25;
const EMBED_BAR = 0.50;
const mixed = (combine) => ({
    embed: 'paraphrase-multilingual',
    prepare: (title) => ({tri: trigrams(title), vec: vectors.get(`paraphrase-multilingual\u0000${title}`)}),
    score: (a, b) => combine(
        jaccard(a.tri, b.tri) / TRIGRAM_BAR,
        (a.vec && b.vec ? cosine(a.vec, b.vec) : 0) / EMBED_BAR,
    ),
    sweep: [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.4, 1.6],
});

const MEASURES = {
    trigram: {prepare: trigrams, score: jaccard,
        sweep: [0.20, 0.22, 0.25, 0.27, 0.30, 0.33, 0.35, 0.40, 0.45]},
    idf: {prepare: tokens, score: cosineIdf,
        sweep: [0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.60]},
    idfShared: {prepare: tokens, score: cosineShared,
        sweep: [0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.60]},
    multilingual: embedding('paraphrase-multilingual'),
    either: mixed(Math.max),        // trigrams OR the model
    both: mixed(Math.min),          // trigrams AND the model
};

// document frequency over the whole window of a language, not over the results of one search:
// a search for "referee" must not make the word rare
const idfFor = async (language) => {
    const feedUrls = Links.getCategoriesLinks(Links.categories(language), language);
    const rows = await prisma.$queryRawUnsafe(`
        SELECT a.title, lower(substring(a.link from '^https?://(?:www[.])?([^/:?#]+)')) AS host
        FROM articles a JOIN feeds f ON f.id = a.id_feed
        WHERE f.url = ANY($1::text[]) AND COALESCE(a.published_at, a.created_at) >= now() - ($2 || ' day')::interval`,
        feedUrls, String(days));

    const df = new Map();
    const hosts = new Map();        // the different media that use each word
    for (const {title, host} of rows) for (const word of tokens(title)) {
        df.set(word, (df.get(word) ?? 0) + 1);
        if (!hosts.has(word)) hosts.set(word, new Set());
        hosts.get(word).add(host);
    }

    const total = rows.length || 1;
    const idf = new Map();
    for (const [word, count] of df) idf.set(word, Math.log(total / count));

    const media = new Map();
    for (const [word, set] of hosts) media.set(word, set.size);
    return {idf, media, total};
};

// ---------------------------------------------------------------------------------------------
// Part 1: does one threshold separate the pairs judged by hand?
// ---------------------------------------------------------------------------------------------
const findArticles = async (fragments) => {
    const rows = await prisma.$queryRawUnsafe(`
        SELECT DISTINCT ON (a.title) a.title,
               lower(substring(a.link from '^https?://(?:www[.])?([^/:?#]+)')) AS host
        FROM articles a
        WHERE ${fragments.map((_, i) => `a.title ILIKE '%' || $${i + 1} || '%'`).join(' OR ')}`,
        ...fragments);
    return rows;
};

const pairsOf = (rows) => {
    const out = [];
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++)
        out.push([rows[i].title, rows[j].title, rows[i].host !== rows[j].host]);
    return out;
};

const judged = async () => {
    const {idf, media} = await idfFor('en');
    const others = await Promise.all(['fr', 'es', 'it', 'de'].map(idfFor));
    for (const one of others) {
        for (const [word, value] of one.idf) if (!idf.has(word)) idf.set(word, value);
        for (const [word, count] of one.media) media.set(word, Math.max(media.get(word) ?? 0, count));
    }

    const collect = async (sets) => {
        const out = [];
        for (const [name, fragments] of Object.entries(sets)) {
            const rows = await findArticles(fragments);
            if (rows.length < 2) { console.log(`  (skipped "${name}": ${rows.length} of its articles are still in the cache)`); continue; }
            out.push(...pairsOf(rows).map(pair => [name, ...pair]));
        }
        return out;
    };

    console.log(`Pairs judged by hand, over the last ${days} days:`);
    const same = await collect(SAME);
    const apart = await collect(APART);
    // A pair inside one medium can never inflate a corroboration count: its card says "this source
    // only" whatever the grouping does. Only the pairs between different media can make the reader
    // believe several papers checked the same fact, so they are counted apart.
    const crossMedia = apart.filter(([, , , cross]) => cross);
    console.log(`  ${same.length} pairs that must group, ${apart.length} that must not`);
    console.log(`  of those, ${crossMedia.length} are between DIFFERENT media — the only ones that can`);
    console.log(`  inflate a count; the others land on a card already saying "this source only"\n`);

    const allTitles = [...new Set([...same, ...apart].flatMap(([, a, b]) => [a, b]))];

    for (const [name, measure] of Object.entries(MEASURES)) {
        if (measure.embed) {
            const started = Date.now();
            try { await embedAll(allTitles, measure.embed); }
            catch (error) { console.log(`--- ${name}
    unavailable: ${error.message}
`); continue; }
            console.log(`--- ${name}  (${allTitles.length} titles embedded in ${Date.now() - started} ms)`);
        }
        const scoreOf = ([, a, b]) => measure.score(measure.prepare(a), measure.prepare(b), idf, media);
        const sameScores = same.map(scoreOf);
        const apartScores = apart.map(scoreOf);

        if (!measure.embed) console.log(`--- ${name}`);
        console.log(`    must group : worst ${Math.min(...sameScores).toFixed(3)}, median ${median(sameScores).toFixed(3)}`);
        console.log(`    must not   : best  ${Math.max(...apartScores).toFixed(3)}, median ${median(apartScores).toFixed(3)}`);
        const crossScores = crossMedia.map(scoreOf);
        console.log(`    threshold   caught/${same.length}   wrong/${apart.length}   of which cross-media/${crossMedia.length}`);
        for (const threshold of measure.sweep) {
            const caught = sameScores.filter(score => score >= threshold).length;
            const wrong = apartScores.filter(score => score >= threshold).length;
            const cross = crossScores.filter(score => score >= threshold).length;
            const mark = cross === 0 && caught > 0 ? '   <-- no count inflated' : '';
            console.log(`      ${threshold.toFixed(2)}       ${String(caught).padStart(3)}        ${String(wrong).padStart(3)}              ${String(cross).padStart(3)}${mark}`);
        }

        // the pairs that keep them from separating
        const worst = same.map((pair, i) => [sameScores[i], pair]).sort((a, b) => a[0] - b[0]).slice(0, 2);
        const best = apart.map((pair, i) => [apartScores[i], pair]).sort((a, b) => b[0] - a[0]).slice(0, 2);
        console.log(`    hardest to catch:`);
        for (const [score, [name2, a, b]] of worst) console.log(`      ${score.toFixed(3)} [${name2}] ${a.slice(0, 58)} / ${b.slice(0, 58)}`);
        console.log(`    hardest to reject:`);
        for (const [score, [name2, a, b]] of best) console.log(`      ${score.toFixed(3)} [${name2}] ${a.slice(0, 58)} / ${b.slice(0, 58)}`);
        console.log();
    }
};

const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

// ---------------------------------------------------------------------------------------------
// Part 2: what each measure does to real searches
// ---------------------------------------------------------------------------------------------
const SEARCHES = [
    ['en', ['referee']], ['en', ['trump']], ['en', ['court']], ['en', ['china']], ['en', ['football']],
    ['fr', ['ONU']], ['fr', ['gouvernement']], ['fr', ['Macron']],
    ['es', ['gobierno']], ['es', ['partido']], ['it', ['governo']], ['de', ['regierung']],
];

const groupsOf = (ids, linked) => {
    const parent = new Map(ids.map(i => [i, i]));
    const find = (i) => { while (parent.get(i) !== i) i = parent.get(i); return i; };
    for (const [a, b] of linked) { const [x, y] = [find(a), find(b)]; if (x !== y) parent.set(y, x); }
    const groups = new Map();
    for (const i of ids) groups.set(find(i), [...(groups.get(find(i)) ?? []), i]);
    return [...groups.values()];
};

const onSearches = async (thresholds) => {
    console.log(`\n\nWhat each measure does to real searches (threshold: ${JSON.stringify(thresholds)})\n`);
    const head = 'search'.padEnd(20) + ['articles', ...Object.keys(MEASURES).flatMap(n => [n, 'biggest'])]
        .map(h => h.padStart(10)).join('');
    console.log(head);
    console.log('-'.repeat(head.length));

    const cache = new Map();
    for (const [language, keywords] of SEARCHES) {
        if (!cache.has(language)) cache.set(language, await idfFor(language));
        const {idf, media} = cache.get(language);

        const rows = await FeedModel.searchArticles({
            feedUrls: Links.getCategoriesLinks(Links.categories(language), language),
            keywords: Filter.parse(keywords),
            timeframe: {start: new Date(Date.now() - days * 864e5), end: new Date()},
        });
        const articles = [...new Map(rows.map(a => [a.link, a])).values()];
        if (articles.length < 2) { console.log(`${`${language} ${keywords}`.padEnd(22)}  (too few)`); continue; }

        const line = [articles.length];
        for (const [name, measure] of Object.entries(MEASURES)) {
            if (measure.embed) {
                try { await embedAll(articles.map(a => a.title), measure.embed); }
                catch { line.push('-', '-'); continue; }
            }
            const prepared = articles.map(a => measure.prepare(a.title));
            const linked = [];
            for (let i = 0; i < articles.length; i++)
                for (let j = i + 1; j < articles.length; j++)
                    if (measure.score(prepared[i], prepared[j], idf, media) >= thresholds[name])
                        linked.push([articles[i].id, articles[j].id]);

            const groups = groupsOf(articles.map(a => a.id), linked);
            line.push(groups.filter(g => g.length > 1).length, Math.max(...groups.map(g => g.length)));
        }
        console.log(`${language} ${keywords}`.padEnd(20) + line.map(v => String(v).padStart(10)).join(''));
    }
    console.log('\n("trigram"/"idf" = groups holding several articles, "biggest" = articles in the largest group)');
};

await judged();
await onSearches({trigram: 0.30, idf: 0.25, idfShared: 0.25, multilingual: 0.60, nomic: 0.75});

// ---------------------------------------------------------------------------------------------
// Part 3: the grouping itself, not the pairs.
//
// A measure can judge every pair well and still build nonsense, because single-link chains: A and
// B, B and C, so A and C, whatever A and C have to do with each other. So each measure is run with
// each way of building the groups, over a realistic set of articles, and judged on whether the
// groups read by hand end up whole and apart.
// ---------------------------------------------------------------------------------------------
const SIZE = 500;

// what the code does today
const single = (items, sim, threshold) => {
    const parent = items.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) i = parent[i]; return i; };
    for (let i = 0; i < items.length; i++)
        for (let j = i + 1; j < items.length; j++)
            if (sim(i, j) >= threshold) { const [a, b] = [find(i), find(j)]; if (a !== b) parent[b] = a; }

    const groups = new Map();
    items.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));
    return [...groups.values()];
};

// an article joins the group it resembles ON AVERAGE, so one lucky link no longer drags a whole
// group along: the textbook answer to chaining
const average = (items, sim, threshold) => {
    const groups = [];
    for (let i = 0; i < items.length; i++) {
        let best = null, bestScore = threshold;
        for (const group of groups) {
            const score = group.reduce((sum, j) => sum + sim(i, j), 0) / group.length;
            if (score >= bestScore) { best = group; bestScore = score; }
        }
        if (best) best.push(i); else groups.push([i]);
    }
    return groups;
};

// the same, but knowing only the pairs the database returns: everything under the threshold reads
// as zero. If this scores like 'average', the SQL query can stay as it is and only the grouping
// changes; if it does not, the similarities have to be computed in full.
const averageSparse = (items, sim, threshold) => average(items, (i, j) => {
    const score = sim(i, j);
    return score >= threshold ? score : 0;
}, threshold);

const STRATEGIES = {single, average, averageSparse};

const grouping = async () => {
    console.log('\n\n================ Part 3: building the groups, not judging pairs ================\n');

    const wanted = new Map();       // title fragment -> which judged group it belongs to
    for (const [name, fragments] of Object.entries(SAME)) for (const f of fragments) wanted.set(f, `same:${name}`);
    for (const [name, fragments] of Object.entries(APART)) for (const f of fragments) wanted.set(f, `apart:${name}`);

    const head = 'measure / strategy'.padEnd(26) + ['thresh', 'groups>1', 'biggest', 'whole/10', 'merged'].map(h => h.padStart(11)).join('');

    for (const language of ['en', 'fr', 'es', 'it']) {
        const feedUrls = Links.getCategoriesLinks(Links.categories(language), language);
        const rows = await prisma.$queryRawUnsafe(`
            SELECT a.title, lower(substring(a.link from '^https?://(?:www[.])?([^/:?#]+)')) AS host
            FROM articles a JOIN feeds f ON f.id = a.id_feed
            WHERE f.url = ANY($1::text[]) AND COALESCE(a.published_at, a.created_at) >= now() - ($2 || ' day')::interval
            ORDER BY COALESCE(a.published_at, a.created_at) DESC LIMIT ${SIZE}`, feedUrls, String(days));
        if (rows.length < 50) continue;

        // make sure the articles judged by hand are in the set, so the grouping can be scored
        const titles = new Set(rows.map(r => r.title));
        for (const fragment of wanted.keys()) {
            const found = await findArticles([fragment]);
            for (const row of found) if (!titles.has(row.title)) { rows.push(row); titles.add(row.title); }
        }

        const labelOf = (title) => {
            for (const [fragment, label] of wanted) if (title.includes(fragment)) return label;
            return null;
        };
        const labels = rows.map(r => labelOf(r.title));
        const present = new Set(labels.filter(Boolean));
        const sameHere = [...present].filter(l => l.startsWith('same:'));

        console.log(`--- ${language}, ${rows.length} articles, ${sameHere.length} judged groups present`);
        console.log(head);

        const {idf, media} = await idfFor(language);
        for (const [name, measure] of Object.entries(MEASURES)) {
            if (name === 'idf' || name === 'idfShared') continue;        // measured worse already
            if (measure.embed) { try { await embedAll(rows.map(r => r.title), measure.embed); } catch { continue; } }

            const prepared = rows.map(r => measure.prepare(r.title));
            const cache = new Map();
            const sim = (i, j) => {
                const key = i < j ? `${i}:${j}` : `${j}:${i}`;
                if (!cache.has(key)) cache.set(key, measure.score(prepared[i], prepared[j], idf, media));
                return cache.get(key);
            };

            for (const [strategyName, strategy] of Object.entries(STRATEGIES)) {
                for (const threshold of measure.sweep.filter((_, i) => i % 2 === 0)) {
                    const groups = strategy(rows, sim, threshold);

                    // a judged group counts as found when all of its articles are in one group
                    // and that group holds no article of another judged group
                    let whole = 0;
                    for (const label of sameHere) {
                        const mine = labels.map((l, i) => l === label ? i : -1).filter(i => i >= 0);
                        const holder = groups.find(g => g.includes(mine[0]));
                        const clean = holder.every(i => !labels[i] || labels[i] === label);
                        if (mine.every(i => holder.includes(i)) && clean) whole++;
                    }

                    // articles of different media wrongly put in one group: the count the reader sees
                    let merged = 0;
                    for (const group of groups) {
                        const kinds = new Set(group.map(i => labels[i]).filter(Boolean));
                        const hosts = new Set(group.map(i => rows[i].host));
                        if (kinds.size > 1 && hosts.size > 1) merged++;
                    }

                    console.log(`${`${name} / ${strategyName}`.padEnd(26)}` + [threshold.toFixed(2),
                        groups.filter(g => g.length > 1).length, Math.max(...groups.map(g => g.length)),
                        `${whole}/${sameHere.length}`, merged].map(v => String(v).padStart(11)).join(''));
                }
            }
        }
        console.log();
    }
};

await grouping();
await prisma.$disconnect();
