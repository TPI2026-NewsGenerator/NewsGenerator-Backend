//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: dup-eval.mjs
//  Description: How well do the steps against duplicates work on the briefings the readers really got (the user, 12.11.2026: "mon ami a toujours des
//               problèmes avec des doublons ... mesure l'efficacité de ceci"). Three kinds of duplicate are looked at in the SAVED briefings:
//               - inside a briefing: two cards of the same news (steps: the vectors, mergeStories, sameNewsGroups of card-merge.js)
//               - across the briefings of one profile: a card telling a news a card of an earlier briefing already told (steps: repeats.js,
//                 which counts only the cards SENT BY E-MAIL in the last 48 h, and old-news.js)
//               - inside a card: the same article or the same news twice among its angles/articles
//               First the objective part (same article or same story on two cards), then the semantic part: candidate pairs by the vectors of
//               bge-m3 (the embedder of the server), judged blind by readers from the full texts
//
//  node --env-file=.env bench/dup-eval.mjs build [since]      the briefings, bench/data/dup-eval/dataset.json
//  node --env-file=.env bench/dup-eval.mjs exact              same article / same story on two cards, inside and across briefings
//

import process from 'node:process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {prisma} from '../config/db.js';
import {embed, denseSimilarity} from '../services/utils/embedder.js';

const DIR = 'bench/data/dup-eval';
const norm = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const words = (text) => norm(text).split(' ').filter(Boolean);
const textOf = (item) => String(item.translation ?? item.summary ?? '').replace(/[-⚠]/g, '');
const REGENERATION_HOURS = 3;

const build = async (since = '2026-10-25') => {
    const rows = await prisma.$queryRawUnsafe(`SELECT id, id_profile, id_user, created_at, hours, jsonb_array_length(items)::int AS n, items FROM briefings
        WHERE status = 'ready' AND created_at > $1::timestamptz AND jsonb_typeof(items) = 'array' AND jsonb_array_length(items) >= 5 ORDER BY id_profile, created_at`, since);
    const briefings = rows.map(row => ({
        id: row.id, profile: row.id_profile, user: row.id_user, at: row.created_at.toISOString(), hours: row.hours,
        cards: row.items.map((item, i) => ({
            n: i + 1, storyId: item.storyId, merged: item.mergedStoryIds ?? [], title: norm(item.titleTranslation ?? item.title), titleOriginal: norm(item.title),
            source: item.lead?.source ?? '', media: item.corroboration?.media ?? 1, language: item.language ?? null,
            names: (item.names ?? []).slice(0, 8).map(name => ({qid: name.qid ?? null, name: name.name})),
            text: textOf(item).split(/\n\n/).slice(0, 3).map(norm).join('\n'),
            urls: [...new Set([item.lead?.url, ...(item.articles ?? []).map(article => article.url)].filter(Boolean))],
            angleUrls: (item.angles ?? []).map(angle => angle.url).filter(Boolean), angleTitles: (item.angles ?? []).map(angle => norm(angle.titleTranslation ?? angle.title)),
            foldedAngles: (item.angles ?? []).filter(angle => angle.folded).length, followUp: item.followUp ?? null, sentAt: item.sentAt ?? null,
            publishedAt: item.publishedAt ?? null, imported: item.imported ?? false, version: item.version?.briefingId ?? null,
        })),
    }));
    mkdirSync(DIR, {recursive: true});
    writeFileSync(`${DIR}/dataset.json`, JSON.stringify(briefings));
    const byProfile = {};
    for (const briefing of briefings) byProfile[briefing.profile] = (byProfile[briefing.profile] ?? 0) + 1;
    console.log(`${briefings.length} briefings, ${briefings.reduce((sum, one) => sum + one.cards.length, 0)} cards, profiles ${JSON.stringify(byProfile)}`);
};

const load = () => JSON.parse(readFileSync(`${DIR}/dataset.json`, 'utf8'));
const ids = (card) => new Set([card.storyId, ...card.merged].filter(id => Number.isInteger(id) && id > 0));
const shared = (a, b) => {
    const sa = ids(a), sb = ids(b);
    const story = [...sa].some(id => sb.has(id));
    const ub = new Set(b.urls);
    const url = a.urls.some(u => ub.has(u));
    return {story, url};
};

const exact = () => {
    const briefings = load();
    // 1. inside a briefing
    let inside = 0, insideCards = 0;
    for (const briefing of briefings) {
        insideCards += briefing.cards.length;
        const cards = briefing.cards;
        for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
            const s = shared(cards[i], cards[j]);
            if (s.story || s.url) { inside++; console.log(`  inside ${briefing.id}: #${cards[i].n} "${cards[i].title.slice(0, 60)}" + #${cards[j].n} "${cards[j].title.slice(0, 60)}" story=${s.story} url=${s.url}`); }
        }
    }
    console.log(`inside a briefing: ${inside} pairs sharing a story or an article, in ${insideCards} cards of ${briefings.length} briefings`);

    // 2. across the briefings of one profile: an earlier briefing (not a regeneration of it: more than 3 h before) within 48 h and 72 h
    const byProfile = new Map();
    for (const briefing of briefings) { if (!byProfile.has(briefing.profile)) byProfile.set(briefing.profile, []); byProfile.get(briefing.profile).push(briefing); }
    const table = [];
    const detail = [];
    for (const [profile, list] of byProfile) {
        list.sort((a, b) => a.at.localeCompare(b.at));
        let cards = 0, repeated = 0, repeatedSent = 0, repeatedFollowUp = 0, sentCards = 0;
        for (const briefing of list) {
            const t = Date.parse(briefing.at);
            const earlier = list.filter(other => Date.parse(other.at) < t - REGENERATION_HOURS * 3600e3 && Date.parse(other.at) >= t - 48 * 3600e3);
            for (const card of briefing.cards) {
                cards++;
                let hit = null, hitSent = false;
                for (const other of earlier) for (const old of other.cards) {
                    const s = shared(card, old);
                    if (s.story || s.url) { hit = {other: other.id, old}; hitSent = hitSent || Boolean(old.sentAt); if (old.sentAt) break; }
                }
                if (hit) {
                    repeated++;
                    if (hitSent) repeatedSent++;
                    if (card.followUp) repeatedFollowUp++;
                    detail.push({profile, briefing: briefing.id, n: card.n, title: card.title.slice(0, 70), earlier: hit.other, earlierTitle: hit.old.title.slice(0, 70), earlierSent: hitSent, followUp: Boolean(card.followUp)});
                }
            }
            sentCards += briefing.cards.filter(card => card.sentAt).length;
        }
        table.push({profile, briefings: list.length, cards, sentCards, repeated48h: repeated, ofWhichEarlierSent: repeatedSent, ofWhichFollowUp: repeatedFollowUp});
    }
    console.table(table);
    writeFileSync(`${DIR}/exact-across.json`, JSON.stringify(detail));
    for (const one of detail.slice(0, 40)) console.log(`  ${one.profile} b${one.briefing} #${one.n} "${one.title}" <- b${one.earlier} "${one.earlierTitle}" sent=${one.earlierSent} followUp=${one.followUp}`);
};

// ---- the vectors of the cards (title + the first words of the text), one per distinct text
const WORDS = 60;
const forVector = (card) => `${card.title}. ${card.text.split(/\s+/).slice(0, WORDS).join(' ')}`;
const vectors = async () => {
    const briefings = load();
    const texts = [...new Set(briefings.flatMap(briefing => briefing.cards.map(forVector)))];
    console.log(`${texts.length} texts to embed`);
    const out = {};
    const started = Date.now();
    for (let i = 0; i < texts.length; i += 64) {
        const batch = texts.slice(i, i + 64);
        const dense = await embed(batch);
        batch.forEach((text, k) => { out[text] = Array.from(dense[k].dense ?? dense[k]).map(x => Math.round(x * 1e5) / 1e5); });
        console.log(`  ${Math.min(i + 64, texts.length)}/${texts.length} ${Math.round((Date.now() - started) / 1000)} s`);
    }
    writeFileSync(`${DIR}/vectors.json`, JSON.stringify(out));
};

// ---- the pairs to judge: inside a briefing, and a card against the best card of the earlier briefings of the same profile (48 h, not a regeneration)
const cosine = (a, b) => { let sum = 0; for (let i = 0; i < a.length; i++) sum += a[i] * b[i]; return sum; };
const pairsOf = (inside, across, low) => {
    const briefings = load();
    const vec = JSON.parse(readFileSync(`${DIR}/vectors.json`, 'utf8'));
    const vecOf = (card) => vec[forVector(card)];
    const all = [];
    for (const briefing of briefings) {
        const cards = briefing.cards;
        for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
            const cos = cosine(vecOf(cards[i]), vecOf(cards[j]));
            const s = shared(cards[i], cards[j]);
            if (cos >= low || s.story || s.url) all.push({kind: 'inside', briefing: briefing.id, profile: briefing.profile, a: cards[i], b: cards[j], cos, exact: s.story || s.url});
        }
    }
    const byProfile = new Map();
    for (const briefing of briefings) { if (!byProfile.has(briefing.profile)) byProfile.set(briefing.profile, []); byProfile.get(briefing.profile).push(briefing); }
    for (const [profile, list] of byProfile) for (const briefing of list) {
        const t = Date.parse(briefing.at);
        const earlier = list.filter(other => Date.parse(other.at) < t - REGENERATION_HOURS * 3600e3 && Date.parse(other.at) >= t - 48 * 3600e3);
        for (const card of briefing.cards) {
            let best = null;
            for (const other of earlier) for (const old of other.cards) {
                const cos = cosine(vecOf(card), vecOf(old));
                const s = shared(card, old);
                const score = cos + (s.story || s.url ? 1 : 0);
                if (!best || score > best.score) best = {score, cos, other, old, exact: s.story || s.url};
            }
            if (best && (best.cos >= low || best.exact)) all.push({kind: 'across', briefing: briefing.id, profile, a: best.old, aBriefing: best.other.id, b: card, cos: best.cos, exact: best.exact,
                earlierSent: Boolean(best.old.sentAt) && Date.parse(best.old.sentAt) < t, followUp: Boolean(card.followUp)});
        }
    }
    return all;
};

const histogram = () => {
    const all = pairsOf(true, true, 0.5);
    for (const kind of ['inside', 'across']) {
        const list = all.filter(pair => pair.kind === kind);
        const bands = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 1.01];
        const row = bands.slice(0, -1).map((lo, i) => `${lo}-${bands[i + 1]}: ${list.filter(pair => pair.cos >= lo && pair.cos < bands[i + 1]).length}`);
        console.log(`${kind}: ${list.length} pairs >= 0.5 (${list.filter(pair => pair.exact).length} sharing a story or an article)  ${row.join('  ')}`);
    }
};

// the pairs written for the judges: every pair from HIGH up, every pair sharing a story or an article, and a sample of the band LOW..HIGH
const HIGH = Number(process.env.HIGH ?? 0.72);
const LOW = Number(process.env.LOW ?? 0.62);
const SAMPLE_BAND = Number(process.env.BAND ?? 40);
const writePairs = () => {
    const all = pairsOf(true, true, LOW);
    let seed = 20261112;
    const random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const shuffle = (list) => list.map(x => [random(), x]).sort((x, y) => x[0] - y[0]).map(([, x]) => x);
    const sure = all.filter(pair => pair.cos >= HIGH || pair.exact);
    const band = shuffle(all.filter(pair => pair.cos < HIGH && !pair.exact));
    const picked = [...sure, ...band.slice(0, SAMPLE_BAND)];
    const key = shuffle(picked).map((pair, i) => ({n: i + 1, kind: pair.kind, briefing: pair.briefing, profile: pair.profile, a: pair.a.n, b: pair.b.n, aBriefing: pair.aBriefing ?? pair.briefing,
        cos: Math.round(pair.cos * 1000) / 1000, exact: pair.exact, band: pair.cos < HIGH && !pair.exact, earlierSent: pair.earlierSent ?? null, followUp: pair.followUp ?? null,
        aTitle: pair.a.title, bTitle: pair.b.title, aStory: pair.a.storyId, bStory: pair.b.storyId, bMerged: pair.b.merged, aMerged: pair.a.merged, bMedia: pair.b.media, aMedia: pair.a.media,
        aFoldedAngles: pair.a.foldedAngles, bFoldedAngles: pair.b.foldedAngles, _a: pair.a, _b: pair.b}));
    const bandCount = band.length;
    const NL = String.fromCharCode(10);
    const view = (card) => `${card.title} (${card.source}${card.publishedAt ? `, published ${card.publishedAt.slice(0, 16).replace('T', ' ')}` : ''}, ${card.media} media)${NL}${words(card.text).slice(0, 110).join(' ')}`;
    const parts = key.map(one => [`## Pair ${one.n}`, '', `**Card A**${one.kind === 'across' ? ' (read in an earlier briefing)' : ''} — ${view(one._a)}`, '', `**Card B**${one.kind === 'across' ? ' (shown later)' : ''} — ${view(one._b)}`, ''].join(NL));
    const md = parts.join(NL);
    writeFileSync(`${DIR}/judge-key.json`, JSON.stringify(key.map(({_a, _b, ...rest}) => rest)));
    writeFileSync(`${DIR}/judge.md`, md);
    for (const kind of ['inside', 'across']) console.log(`${kind}: ${key.filter(one => one.kind === kind).length} pairs (${key.filter(one => one.kind === kind && one.exact).length} exact, ${key.filter(one => one.kind === kind && one.band).length} in the band ${LOW}-${HIGH} sampled of ${all.filter(pair => pair.kind === kind && pair.cos < HIGH && !pair.exact).length})`);
    console.log(`band total ${bandCount}, sampled ${Math.min(SAMPLE_BAND, bandCount)}`);
    // the judge file in slices of 40 pairs
    const size = 40;
    for (let i = 0; i < key.length; i += size) writeFileSync(`${DIR}/judge-${String(i / size + 1).padStart(2, '0')}.md`, parts.slice(i, i + size).join(NL));
    console.log(`${Math.ceil(key.length / size)} slices of ${size} pairs`);
};

// ---- the two readers of the whole briefing (card-merge.js) replayed on the saved cards, each reader's groups kept apart
const replay = async () => {
    const {ProfileModel} = await import('../models/profile-model.js');
    const {readerLanguage} = await import('../services/utils/language.js');
    const {newUsage, ollamaJson} = await import('../services/utils/ollama.js');
    const {mapWithConcurrency} = await import('../services/utils/concurrency.js');
    const {mergePrompt, normalizeGroups, agreedGroups, MERGE_MODEL} = await import('../services/utils/card-merge.js');
    const briefings = load();
    const rows = await prisma.$queryRawUnsafe('SELECT id, id_profile, items FROM briefings WHERE id = ANY($1::int[])', briefings.map(briefing => briefing.id));
    const profiles = new Map();
    const usage = newUsage();
    const started = Date.now();
    const results = await mapWithConcurrency(rows, 3, async (row) => {
        if (!profiles.has(row.id_profile)) profiles.set(row.id_profile, row.id_profile ? await ProfileModel.get(row.id_profile) : null);
        const language = readerLanguage(profiles.get(row.id_profile) ?? {});
        const prompt = mergePrompt(row.items, language);
        const ask = (options) => ollamaJson(prompt, usage, options).then(value => ({ok: true, value}), error => ({ok: false, error: error.message}));
        const [fast, slow] = await Promise.all([ask({timeoutMs: 200e3}), ask({model: MERGE_MODEL, think: true, fallback: null, timeoutMs: 300e3})]);
        const first = fast.ok ? normalizeGroups(fast.value, row.items.length) : null;
        const second = slow.ok ? normalizeGroups(slow.value, row.items.length) : null;
        console.log(`briefing ${row.id}: ${first ? first.length : 'FAILED'} / ${second ? second.length : 'FAILED'} groups`);
        return {id: row.id, first, second, agreed: first && second ? agreedGroups(first, second) : null};
    });
    writeFileSync(`${DIR}/replay.json`, JSON.stringify({seconds: Math.round((Date.now() - started) / 1000), usage, results: results.map(result => result.status === 'fulfilled' ? result.value : {failed: true})}));
    console.log(`${results.length} briefings in ${Math.round((Date.now() - started) / 1000)} s, tokens ${JSON.stringify(usage)}`);
};

// ---- the verdicts
const verdictsOf = () => {
    const key = JSON.parse(readFileSync(`${DIR}/judge-key.json`, 'utf8'));
    const judges = ['A', 'B'].map(letter => {
        const map = new Map();
        for (let slice = 1; slice <= 20; slice++) {
            const file = `${DIR}/verdicts-${letter}-${String(slice).padStart(2, '0')}.json`;
            if (!existsSync(file)) continue;
            for (const [n, value] of Object.entries(JSON.parse(readFileSync(file, 'utf8')))) map.set(Number(n), typeof value === 'string' ? value : value.verdict);
        }
        return map;
    });
    return {key, judges};
};

const score = () => {
    const {key, judges} = verdictsOf();
    const [a, b] = judges;
    const both = b.size > 0;
    const final = new Map(key.map(one => {
        const x = a.get(one.n), y = b.get(one.n);
        // two judges: the verdict stands when they agree; when they split, SAME against DEVELOPMENT counts as DEVELOPMENT (the doubt does not hide a news), else DISPUTED
        let verdict = x;
        if (both && y !== undefined) verdict = x === y ? x : ([x, y].includes('DIFFERENT') ? 'DISPUTED' : 'DEVELOPMENT');
        return [one.n, verdict ?? 'MISSING'];
    }));
    console.log(`${key.length} pairs, judge A ${a.size}, judge B ${b.size}${both ? `, agree on ${key.filter(one => a.get(one.n) === b.get(one.n)).length}` : ''}`);
    const count = (list) => list.reduce((acc, one) => { const v = final.get(one.n); acc[v] = (acc[v] ?? 0) + 1; return acc; }, {});
    for (const kind of ['inside', 'across']) {
        const list = key.filter(one => one.kind === kind);
        console.log(`${kind}: all pairs ${JSON.stringify(count(list))}; vectors >= 0.72 or exact ${JSON.stringify(count(list.filter(one => !one.band)))}; sampled band ${JSON.stringify(count(list.filter(one => one.band)))}`);
    }
    const briefings = load();
    const same = key.filter(one => final.get(one.n) === 'SAME');
    const insideSame = same.filter(one => one.kind === 'inside');
    console.log(`SAME inside a briefing: ${insideSame.length} pairs in ${new Set(insideSame.map(one => one.briefing)).size} of ${briefings.length} briefings`);
    for (const one of insideSame) console.log(`  b${one.briefing} #${one.a}+#${one.b} cos ${one.cos}${one.exact ? ' exact' : ''}: "${one.aTitle.slice(0, 60)}" + "${one.bTitle.slice(0, 60)}"`);
    const acrossSame = same.filter(one => one.kind === 'across');
    const sameAndDev = key.filter(one => one.kind === 'across' && ['SAME', 'DEVELOPMENT'].includes(final.get(one.n)));
    const split = (list) => {
        const c = {sentNotFollow: 0, sentFollow: 0, notSent: 0, viaMerge: 0};
        for (const one of list) {
            if (!one.earlierSent) c.notSent++;
            else if (one.followUp) c.sentFollow++;
            else c.sentNotFollow++;
            if ((one.bMerged ?? []).includes(one.aStory) || (one.bMerged ?? []).some(id => (one.aMerged ?? []).includes(id))) c.viaMerge++;
        }
        return c;
    };
    console.log(`SAME across briefings: ${acrossSame.length} cards ${JSON.stringify(split(acrossSame))}`);
    console.log(`DEVELOPMENT across briefings: ${sameAndDev.length - acrossSame.length} cards ${JSON.stringify(split(sameAndDev.filter(one => final.get(one.n) === 'DEVELOPMENT')))}`);
    for (const one of acrossSame) console.log(`  p${one.profile} b${one.briefing}#${one.b} <- b${one.aBriefing}#${one.a} cos ${one.cos}${one.exact ? ' exact' : ''} sent=${one.earlierSent} followUp=${one.followUp}: "${one.bTitle.slice(0, 55)}" <- "${one.aTitle.slice(0, 55)}"`);
    // the denominator: cards that had an earlier briefing of their profile within 48 h
    let eligible = 0, eligibleByProfile = {};
    const byProfile = new Map();
    for (const briefing of briefings) { if (!byProfile.has(briefing.profile)) byProfile.set(briefing.profile, []); byProfile.get(briefing.profile).push(briefing); }
    for (const [profile, list] of byProfile) for (const briefing of list) {
        const t = Date.parse(briefing.at);
        if (list.some(other => Date.parse(other.at) < t - REGENERATION_HOURS * 3600e3 && Date.parse(other.at) >= t - 48 * 3600e3)) {
            eligible += briefing.cards.length; eligibleByProfile[profile] = (eligibleByProfile[profile] ?? 0) + briefing.cards.length;
        }
    }
    console.log(`cards with an earlier briefing of their profile within 48 h: ${eligible} ${JSON.stringify(eligibleByProfile)}; SAME rate ${(100 * acrossSame.length / eligible).toFixed(1)} %`);
    const perProfile = {};
    for (const one of acrossSame) perProfile[one.profile] = (perProfile[one.profile] ?? 0) + 1;
    console.log('SAME across by profile', JSON.stringify(perProfile));
    writeFileSync(`${DIR}/final.json`, JSON.stringify(key.map(one => ({...one, verdict: final.get(one.n)}))));
};

// the second look: the pairs judge A called SAME, and the ones it called DEVELOPMENT with a very close vector, read by a second judge in another order
const pairsB = () => {
    const {key, judges} = verdictsOf();
    const NL = String.fromCharCode(10);
    const md = readFileSync(`${DIR}/judge.md`, 'utf8');
    const parts = new Map(md.split(NL + '## Pair ').map((part, i) => (i === 0 ? part.replace('## Pair ', '') : part)).map(part => [Number.parseInt(part, 10), '## Pair ' + part.trimEnd() + NL]));
    const wanted = key.filter(one => judges[0].get(one.n) === 'SAME' || (judges[0].get(one.n) === 'DEVELOPMENT' && one.cos >= 0.85)).map(one => one.n).reverse();
    const size = 40;
    for (let i = 0; i < wanted.length; i += size) writeFileSync(`${DIR}/judgeB-${String(i / size + 1).padStart(2, '0')}.md`, wanted.slice(i, i + size).map(n => parts.get(n)).join(NL));
    console.log(`${wanted.length} pairs for the second judge in ${Math.ceil(wanted.length / size)} slices`);
};

// ---- the fix to try: the stories a card joined AFTER the choice (mergedStoryIds) are checked against the cards sent before, as the chosen stories are
// (repeats.js withoutRepeats): the story sent before is asked with the news published since it was sent; no news since = left out; the AI says
// whether they tell something new. Replayed with the real prompt on the across pairs where the earlier card was sent and shares a story with this card
const evolve = async () => {
    const {evolvedStories} = await import('../services/utils/repeats.js');
    const {newUsage} = await import('../services/utils/ollama.js');
    const final = JSON.parse(readFileSync(`${DIR}/final.json`, 'utf8'));
    const briefings = new Map(load().map(briefing => [briefing.id, briefing]));
    const usage = newUsage();
    const rows = [];
    for (const one of final.filter(pair => pair.kind === 'across' && pair.earlierSent)) {
        const old = briefings.get(one.aBriefing).cards.find(card => card.n === one.a);
        const card = briefings.get(one.briefing).cards.find(card => card.n === one.b);
        const mine = new Set([card.storyId, ...card.merged].filter(id => Number.isInteger(id) && id > 0));
        const theirs = [old.storyId, ...old.merged].filter(id => Number.isInteger(id) && id > 0);
        if (!theirs.some(id => mine.has(id))) continue;
        const since = await prisma.$queryRawUnsafe(`SELECT DISTINCT ON (a.link) a.title, a.description, COALESCE(a.published_at, a.created_at) AS at FROM articles a
            WHERE a.id_story = ANY($1::int[]) AND COALESCE(a.published_at, a.created_at) > $2::timestamptz ORDER BY a.link, COALESCE(a.published_at, a.created_at) DESC`, [...mine], old.sentAt);
        rows.push({one, old, card, since: since.sort((x, y) => y.at - x.at).slice(0, 6)});
    }
    const asked = rows.filter(row => row.since.length > 0);
    const answers = new Map();
    for (let i = 0; i < asked.length; i += 30) {
        const batch = asked.slice(i, i + 30);
        const yes = await evolvedStories(batch.map(row => ({id: String(row.one.n), title: row.old.title, since: row.since})), usage);
        for (const row of batch) answers.set(row.one.n, yes.has(String(row.one.n)) ? (yes.get(String(row.one.n)) ?? 'yes') : null);
    }
    const table = {};
    for (const row of rows) {
        const evolved = answers.has(row.one.n) && answers.get(row.one.n) !== null;
        const outcome = row.since.length === 0 ? 'no news since: left out' : evolved ? 'evolved: kept as follow-up' : 'not new: left out';
        const key = `${row.one.verdict} / ${row.one.followUp ? 'was follow-up' : 'was shown as new'} / ${outcome}`;
        table[key] = (table[key] ?? 0) + 1;
        if (process.env.VERBOSE) console.log(`${key} :: b${row.one.briefing}#${row.one.b} "${row.card.title.slice(0, 55)}" <- "${row.old.title.slice(0, 55)}" since ${row.since.length}${evolved ? ` fact: ${answers.get(row.one.n)}` : ''}`);
    }
    console.log(`${rows.length} pairs, ${asked.length} asked, tokens ${JSON.stringify(usage)}`);
    for (const [key, n] of Object.entries(table).sort()) console.log(String(n).padStart(3), key);
};

// what the two readers found in the replay, against the verdicts of the pairs inside a briefing
const replayScore = () => {
    const final = JSON.parse(readFileSync(`${DIR}/final.json`, 'utf8')).filter(one => one.kind === 'inside');
    const out = JSON.parse(readFileSync(`${DIR}/replay.json`, 'utf8'));
    const pairKeys = (groups) => new Set((groups ?? []).flatMap(group => group.flatMap((x, i) => group.slice(i + 1).map(y => `${Math.min(x, y) + 1}-${Math.max(x, y) + 1}`))));
    const sets = new Map(out.results.map(result => [result.id, {first: pairKeys(result.first), second: pairKeys(result.second), agreed: pairKeys(result.agreed), failed: result.first === null || result.second === null}]));
    console.log(`replay: ${out.results.length} briefings, ${[...sets.values()].filter(set => set.failed).length} with a reader failing, ${out.seconds} s, ${JSON.stringify(out.usage)}`);
    const judged = new Map(final.map(one => [`${one.briefing}:${Math.min(one.a, one.b)}-${Math.max(one.a, one.b)}`, one.verdict]));
    const truth = final.filter(one => one.verdict === 'SAME');
    const row = (name, pick) => {
        const found = truth.filter(one => pick(sets.get(one.briefing))?.has(`${one.a}-${one.b}`));
        const counts = {};
        let notJudged = 0, total = 0;
        for (const [id, set] of sets) for (const pair of pick(set) ?? []) {
            total++;
            const verdict = judged.get(`${id}:${pair}`);
            if (!verdict) notJudged++; else counts[verdict] = (counts[verdict] ?? 0) + 1;
        }
        console.log(`${name.padEnd(12)} pairs given ${String(total).padStart(3)}: ${JSON.stringify(counts)}, not judged ${notJudged}; true duplicates found ${found.length}/${truth.length}`);
        return found;
    };
    row('gemma', set => set.first);
    row('deepseek', set => set.second);
    const found = row('both agree', set => set.agreed);
    const missed = truth.filter(one => !found.includes(one));
    for (const one of missed) console.log(`  missed b${one.briefing} #${one.a}+#${one.b} cos ${one.cos}: "${one.aTitle.slice(0, 60)}" + "${one.bTitle.slice(0, 60)}"`);
    // the pairs the readers agreed on and no judge saw
    for (const [id, set] of sets) for (const pair of set.agreed) if (!judged.has(`${id}:${pair}`)) console.log(`  agreed but not judged: b${id} ${pair}`);
};

// ---- the candidate fix: the cards of today read against the cards the reader already received (briefings of the 48 h before), by the two readers of card-merge.js
const crossPrompt = (today, received, language) => {
    const NL = String.fromCharCode(10);
    const view = (card, n) => `[${n}] ${card.title}${NL}    ${words(card.text).slice(0, n.startsWith('R') ? 30 : 50).join(' ')}`;
    return `A reader already received these cards in earlier briefings (R1, R2...), then gets a new briefing (T1, T2...). The reader reads in ${language}.${NL}${NL}RECEIVED BEFORE:${NL}${received.map((card, i) => view(card, 'R' + (i + 1))).join(NL)}${NL}${NL}TODAY:${NL}${today.map((card, i) => view(card, 'T' + (i + 1))).join(NL)}${NL}${NL}Find the cards of TODAY that tell THE SAME NEWS as a card RECEIVED BEFORE: the same event, decision, statement or result, so that a reader who has read the received card learns nothing new from the card of today. A card of today on the same affair that tells a different fact is NOT the same news: a reaction to it, a question and its answer, the next step, a consequence, what another person said, another match, another person, a later stage.${NL}${NL}When in doubt, do not group. Answer only in JSON: {"repeats": [{"today": number, "received": number, "same": "the one fact they both tell"}]}`;
};

const cross = async () => {
    const {newUsage, ollamaJson} = await import('../services/utils/ollama.js');
    const {mapWithConcurrency} = await import('../services/utils/concurrency.js');
    const {MERGE_MODEL} = await import('../services/utils/card-merge.js');
    const briefings = load();
    const byProfile = new Map();
    for (const briefing of briefings) { if (!byProfile.has(briefing.profile)) byProfile.set(briefing.profile, []); byProfile.get(briefing.profile).push(briefing); }
    const jobs = [];
    for (const [, list] of byProfile) for (const briefing of list) {
        const t = Date.parse(briefing.at);
        const earlier = list.filter(other => Date.parse(other.at) < t - REGENERATION_HOURS * 3600e3 && Date.parse(other.at) >= t - 48 * 3600e3);
        if (earlier.length === 0) continue;
        // one received card per story (the latest), a card sent keeping its mark
        const received = new Map();
        for (const other of earlier.sort((x, y) => x.at.localeCompare(y.at))) for (const card of other.cards) {
            const id = card.storyId > 0 ? card.storyId : `${other.id}:${card.n}`;
            const known = received.get(id);
            received.set(id, {card, briefing: other.id, sent: Boolean(card.sentAt && Date.parse(card.sentAt) < t) || Boolean(known?.sent)});
        }
        jobs.push({briefing, received: [...received.values()]});
    }
    const usage = newUsage();
    const started = Date.now();
    const results = await mapWithConcurrency(jobs, 3, async ({briefing, received}) => {
        const prompt = crossPrompt(briefing.cards, received.map(one => one.card), briefing.language ?? 'English');
        const ask = (options) => ollamaJson(prompt, usage, options).then(value => ({ok: true, value}), error => ({ok: false, error: error.message}));
        const [fast, slow] = await Promise.all([ask({timeoutMs: 200e3}), ask({model: MERGE_MODEL, think: true, fallback: null, timeoutMs: 400e3})]);
        const pairsOf = (answer) => answer.ok ? (Array.isArray(answer.value?.repeats) ? answer.value.repeats : []).map(one => [Number(one?.today), Number(one?.received)])
            .filter(([x, y]) => Number.isInteger(x) && Number.isInteger(y) && x >= 1 && x <= briefing.cards.length && y >= 1 && y <= received.length) : null;
        const first = pairsOf(fast), second = pairsOf(slow);
        console.log(`briefing ${briefing.id}: ${received.length} received, ${first ? first.length : 'FAILED'} / ${second ? second.length : 'FAILED'} repeats`);
        return {id: briefing.id, received: received.map(one => ({briefing: one.briefing, n: one.card.n, storyId: one.card.storyId, sent: one.sent, title: one.card.title})), first, second};
    });
    writeFileSync(`${DIR}/cross.json`, JSON.stringify({seconds: Math.round((Date.now() - started) / 1000), usage, results: results.map(result => result.status === 'fulfilled' ? result.value : {failed: true})}));
    console.log(`${results.length} briefings in ${Math.round((Date.now() - started) / 1000)} s, tokens ${JSON.stringify(usage)}`);
};

// the pairs the readers of 'cross' gave, against the verdicts of the judged pairs; the ones no judge saw are written for a third look (judgeC-*.md)
const crossScore = () => {
    const final = JSON.parse(readFileSync(`${DIR}/final.json`, 'utf8')).filter(one => one.kind === 'across');
    const out = JSON.parse(readFileSync(`${DIR}/cross.json`, 'utf8'));
    const briefings = new Map(load().map(briefing => [briefing.id, briefing]));
    const judgedBy = new Map();
    for (const one of final) judgedBy.set(`${one.briefing}:${one.b}`, [...(judgedBy.get(`${one.briefing}:${one.b}`) ?? []), one]);
    // C verdicts when they exist
    const extra = new Map();
    for (let slice = 1; slice <= 10; slice++) {
        const file = `${DIR}/verdicts-C-${String(slice).padStart(2, '0')}.json`;
        if (existsSync(file)) for (const [key, value] of Object.entries(JSON.parse(readFileSync(file, 'utf8')))) extra.set(key, typeof value === 'string' ? value : value.verdict);
    }
    const NL = String.fromCharCode(10);
    const todo = new Map();
    const verdictOf = (briefing, n, received) => {
        const judged = (judgedBy.get(`${briefing}:${n}`) ?? []).find(one => (one.aBriefing === received.briefing && one.a === received.n) || (received.storyId > 0 && one.aStory === received.storyId));
        if (judged) return judged.verdict;
        const key = `${briefing}:${n}:${received.briefing}:${received.n}`;
        if (extra.has(key)) return extra.get(key);
        todo.set(key, {briefing, n, received});
        return 'NOT JUDGED';
    };
    const stats = {first: {}, second: {}, agreed: {}};
    const flagged = {first: new Map(), second: new Map(), agreed: new Map()};
    for (const result of out.results.filter(one => !one.failed)) {
        const pairs = (list) => new Map((list ?? []).map(([x, y]) => [`${x}:${y}`, [x, y]]));
        const first = pairs(result.first), second = pairs(result.second);
        const agreed = new Map([...first].filter(([key]) => second.has(key)));
        for (const [name, map] of [['first', first], ['second', second], ['agreed', agreed]]) for (const [, [x, y]] of map) {
            const received = result.received[y - 1];
            const verdict = verdictOf(result.id, x, received);
            const tag = `${verdict}${received.sent ? ' (sent)' : ' (not sent)'}`;
            stats[name][tag] = (stats[name][tag] ?? 0) + 1;
            flagged[name].set(`${result.id}:${x}`, verdict);
        }
    }
    const sameCards = final.filter(one => one.verdict === 'SAME');
    for (const name of ['first', 'second', 'agreed']) {
        const found = sameCards.filter(one => flagged[name].get(`${one.briefing}:${one.b}`) === 'SAME');
        const foundSent = found.filter(one => one.earlierSent);
        console.log(`${name.padEnd(7)} pairs ${JSON.stringify(stats[name])}`);
        console.log(`        SAME cards found ${found.length}/${sameCards.length} (earlier card sent: ${foundSent.length}/${sameCards.filter(one => one.earlierSent).length}); DEVELOPMENT cards flagged ${[...flagged[name].values()].filter(v => v === 'DEVELOPMENT').length} of ${final.filter(one => one.verdict === 'DEVELOPMENT').length}`);
    }
    const view = (card) => `${card.title} (${card.source}${card.publishedAt ? `, published ${card.publishedAt.slice(0, 16).replace('T', ' ')}` : ''}, ${card.media} media)${NL}${words(card.text).slice(0, 110).join(' ')}`;
    const parts = [...todo.entries()].map(([key, one], i) => {
        const today = briefings.get(one.briefing).cards.find(card => card.n === one.n);
        const old = briefings.get(one.received.briefing).cards.find(card => card.n === one.received.n);
        return {key, md: [`## Pair ${key}`, '', `**Card A** (read in an earlier briefing) — ${view(old)}`, '', `**Card B** (shown later) — ${view(today)}`, ''].join(NL)};
    });
    for (let i = 0; i < parts.length; i += 40) writeFileSync(`${DIR}/judgeC-${String(i / 40 + 1).padStart(2, '0')}.md`, parts.slice(i, i + 40).map(part => part.md).join(NL));
    console.log(`${parts.length} pairs given by a reader and not judged yet${parts.length ? ` (judgeC-*.md)` : ''}`);
};

// ---- the policy of the user (12.11.2026): a news SENT by e-mail does not come back unless it evolved. A card of today that shares a story with a card sent, or that the
// readers of 'cross' pair with one, is looked at pair by pair with the full texts: "does it tell the reader something new?" (the verdicts of duplicate-cards.mjs, 'judge')
const STRICT = {
    'gemma-off': {model: 'gemma4:31b', think: undefined},
    'gemma-on': {model: 'gemma4:31b', think: true},
    'deepseek-on': {model: 'deepseek-v4-pro:0813', think: true},
};
const strictPrompt = (a, b) => {
    if (process.env.LOOK === 'event') return eventPrompt(a, b);
    const NL = String.fromCharCode(10);
    return [`A reader received Card A in an earlier briefing. Today's briefing holds Card B.`, '',
        `Card A: ${a.title} (${a.source}, ${a.media} media)${NL}${a.text}`, '',
        `Card B: ${b.title} (${b.source}, ${b.media} media)${NL}${b.text}`, '',
        'Give ONE verdict:',
        '- SAME: both cards report the same news: the same event, decision, statement or result. A reader who has read Card A learns nothing material from Card B. Different wording, a different medium, or a small extra detail does not make them different news.',
        '- DEVELOPMENT: the same affair or topic, but Card B tells at least one fact Card A does not that matters to a reader: a reaction, a question and its answer, the next step, a consequence, what another person said, another stage (announcement vs result), another match or person.',
        '- DIFFERENT: not the same affair, or only the same broad subject.', '',
        'Be strict: if Card B has a fact (a figure, a person\'s statement, a new step) that Card A lacks and that matters to a reader, it is DEVELOPMENT. When both cards tell the same fact, it is SAME even if the titles look unlike.', '',
        'Answer only in JSON: {"verdict": "SAME" or "DEVELOPMENT" or "DIFFERENT", "why": "one short sentence"}'].join(NL);
};
const eventPrompt = (a, b) => {
    const NL = String.fromCharCode(10);
    return ["A reader received Card A in an earlier briefing. Today's briefing holds Card B.", '',
        'Card A: ' + a.title + ' (' + a.source + ', ' + a.media + ' media)' + NL + a.text, '',
        'Card B: ' + b.title + ' (' + b.source + ', ' + b.media + ' media)' + NL + b.text, '',
        'Question: does Card B report a NEW EVENT since Card A, or the same event again?',
        '- SAME: Card B reports the same event, decision, statement or result as Card A. More details, more quotes, more figures, background, another medium, another angle on the same event, or a better written account do NOT make it new.',
        '- DEVELOPMENT: Card B reports something that happened or was said AFTER or BESIDE the event of Card A: a new decision or step, a reaction by someone else, an answer, a consequence, a result after an announcement, another match, another person.',
        '- DIFFERENT: not the same affair, or only the same broad subject.', '',
        'Decide on the event, not on the details. Answer only in JSON: {"verdict": "SAME" or "DEVELOPMENT" or "DIFFERENT", "why": "one short sentence"}'].join(NL);
};
const strict = async (name) => {
    const config = STRICT[name];
    if (!config) throw new Error(`config: ${Object.keys(STRICT).join(', ')}`);
    const {newUsage, ollamaJson} = await import('../services/utils/ollama.js');
    const {mapWithConcurrency} = await import('../services/utils/concurrency.js');
    const final = JSON.parse(readFileSync(`${DIR}/final.json`, 'utf8')).filter(one => one.kind === 'across' && one.earlierSent);
    const briefings = new Map(load().map(briefing => [briefing.id, briefing]));
    const usage = newUsage();
    const started = Date.now();
    const results = await mapWithConcurrency(final, name === 'deepseek-on' ? 3 : 4, async (one) => {
        const a = briefings.get(one.aBriefing).cards.find(card => card.n === one.a), b = briefings.get(one.briefing).cards.find(card => card.n === one.b);
        let answer = null;
        for (let attempt = 0; attempt < 2 && !answer; attempt++) {
            try { answer = await ollamaJson(strictPrompt(a, b), usage, {model: config.model, think: config.think, fallback: null, timeoutMs: 300e3}); } catch { /* asked once more */ }
        }
        return {n: one.n, verdict: typeof answer?.verdict === 'string' ? answer.verdict : null, why: answer?.why ?? null};
    });
    const rows = results.map(result => result.status === 'fulfilled' ? result.value : {verdict: null});
    writeFileSync(`${DIR}/strict-${name}${process.env.LOOK === 'event' ? '-event' : ''}.json`, JSON.stringify({name, usage, seconds: Math.round((Date.now() - started) / 1000), rows}));
    console.log(`${name}: ${rows.length} pairs, ${Math.round((Date.now() - started) / 1000)} s, tokens ${JSON.stringify(usage)}`);
};

const strictScore = () => {
    const final = JSON.parse(readFileSync(`${DIR}/final.json`, 'utf8')).filter(one => one.kind === 'across' && one.earlierSent);
    const truth = new Map(final.map(one => [one.n, one.verdict]));
    const sharedStory = (one) => [one.aStory, ...(one.aMerged ?? [])].filter(id => id > 0).some(id => one.bStory === id || (one.bMerged ?? []).includes(id));
    console.log(`${final.length} pairs where the earlier card was sent: ${JSON.stringify(final.reduce((acc, one) => { acc[one.verdict] = (acc[one.verdict] ?? 0) + 1; return acc; }, {}))}; sharing a story: ${final.filter(sharedStory).length} (SAME ${final.filter(one => sharedStory(one) && one.verdict === 'SAME').length} of ${final.filter(one => one.verdict === 'SAME').length} SAME)`);
    const saved = {};
    for (const name of Object.keys(STRICT)) {
        const file = `${DIR}/strict-${name}${process.env.LOOK === 'event' ? '-event' : ''}.json`;
        if (!existsSync(file)) continue;
        saved[name] = new Map(JSON.parse(readFileSync(file, 'utf8')).rows.map((row, i) => [final[i].n, row.verdict]));
        const table = {};
        for (const one of final) { const key = `${one.verdict} -> ${saved[name].get(one.n) ?? 'no answer'}`; table[key] = (table[key] ?? 0) + 1; }
        console.log(name, JSON.stringify(table));
    }
    if (saved['gemma-off'] && saved['deepseek-on']) {
        const both = final.filter(one => saved['gemma-off'].get(one.n) === 'SAME' && saved['deepseek-on'].get(one.n) === 'SAME');
        const count = (list) => list.reduce((acc, one) => { acc[one.verdict] = (acc[one.verdict] ?? 0) + 1; return acc; }, {});
        console.log('both say SAME:', JSON.stringify(count(both)), '| sharing a story:', JSON.stringify(count(both.filter(sharedStory))));
        const dev = final.filter(one => one.verdict === 'DEVELOPMENT' && saved['deepseek-on'].get(one.n) === 'SAME');
        for (const one of dev) console.log(`  development said SAME by deepseek: b${one.briefing}#${one.b} "${one.bTitle.slice(0, 60)}" <- "${one.aTitle.slice(0, 60)}"`);
    }
};

const [command, argument] = process.argv.slice(2);
if (command === 'strict') await strict(argument);
else if (command === 'strictScore') strictScore();
else if (command === 'crossScore') crossScore();
else if (command === 'cross') await cross();
else if (command === 'replayScore') replayScore();
else if (command === 'evolve') await evolve();
else if (command === 'pairsB') pairsB();
else if (command === 'score') score();
else if (command === 'replay') await replay();
else if (command === 'build') await build(argument);
else if (command === 'exact') exact();
else if (command === 'vectors') await vectors();
else if (command === 'histogram') histogram();
else if (command === 'pairs') writePairs();
else console.error('build [since] | exact | vectors | histogram | pairs');
await prisma.$disconnect();
process.exit(0);
