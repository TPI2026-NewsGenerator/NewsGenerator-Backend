// The input of the per-card analysis bench: the 10 briefings of the analysis bench (analysis-input.mjs),
// each card with the grounded sources that existed when its briefing was made, read only, written to
// data/card-analysis/cards.json
//   node --env-file=.env bench/card-analysis-input.mjs
// Per card (the cards with key passages, numbered as the reader saw them):
//   articles  the lead article and the other articles of its story read again (Crawlers.Html +
//             sentencesOf, as the briefing reads them), numbered sentences, ~12k chars per card in all,
//             the lead first (at least 6k for it); a page that can't be read again: the lead stands as
//             its key passages, an other article is left out
//   timeline  the earlier stories of its thread (stories.id_thread, created before the briefing, the
//             merged stories of the card left out): date + title of the story's first article, its
//             translation in the reader's language (translateTexts), the 12 latest at most
//   angles, contested, official  as stored in briefings.items
//   names     the card's names with a Wikidata item: its description (entities table, else Wikidata)
// Pages are read today, not on the day of the briefing: a page changed since (a live blog) is read as it
// is now.
import fs from 'node:fs';
import pg from 'pg';
import {Crawlers} from '../services/utils/crawlers.js';
import {sentencesOf, splitSentences, translateTexts} from '../services/utils/extract.js';
import {readerLanguage, writtenIn} from '../services/utils/language.js';

const BRIEFINGS = [
    {id: 99, kind: 'single theme: refereeing (Roberto)'},
    {id: 90, kind: 'single theme: refereeing (Roberto)'},
    {id: 100, kind: 'football governance + refereeing (Enzo)'},
    {id: 94, kind: 'football governance + refereeing (Enzo)'},
    {id: 92, kind: 'football leagues, transfers, Ronaldo (E)'},
    {id: 70, kind: 'tech: low-level code, AI for coding, tech news (Fab)'},
    {id: 59, kind: 'tech: low-level code, AI for coding, tech news (Fab)'},
    {id: 29, kind: 'single theme: Pokémon TCG'},
    {id: 34, kind: 'mixed: astronomy + electric cars'},
    {id: 31, kind: 'mixed: French football + gastronomy'},
];
const CARD_CHARS = 12000;
const LEAD_MIN = 6000;
const OTHER_MAX = 3000;
const MAX_ARTICLES = 5;
const TIMELINE_MAX = 12;

const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();

// sentences kept while they fit in 'chars'
const fitted = (sentences, chars) => {
    const out = [];
    let used = 0;
    for (const s of sentences) {
        if (used + s.text.length > chars && out.length > 0) break;
        out.push(s);
        used += s.text.length + 1;
    }
    return out;
};
const size = (sentences) => sentences.reduce((n, s) => n + s.text.length + 1, 0);

// the description of the Wikidata items, the entities table first
const descriptions = async (qids, language) => {
    const out = new Map();
    if (qids.length === 0) return out;
    const {rows} = await client.query('select qid, label, description from entities where qid = any($1)', [qids]);
    for (const r of rows) if (r.description) out.set(r.qid, {label: r.label, description: r.description, from: 'entities'});
    const missing = qids.filter(q => !out.has(q));
    for (let i = 0; i < missing.length; i += 50) {
        const params = new URLSearchParams({action: 'wbgetentities', ids: missing.slice(i, i + 50).join('|'), props: 'labels|descriptions',
            languages: [...new Set([language, 'en'])].join('|'), format: 'json'});
        const res = await fetch(`https://www.wikidata.org/w/api.php?${params}`,
            {headers: {'User-Agent': 'NewsGenerator-bench/1.0 (rostellofabian@gmail.com)'}}).catch(() => null);
        if (!res?.ok) continue;
        const body = await res.json();
        for (const [qid, item] of Object.entries(body.entities ?? {})) {
            const description = item.descriptions?.[language]?.value ?? item.descriptions?.en?.value;
            if (description) out.set(qid, {label: item.labels?.[language]?.value ?? item.labels?.en?.value ?? qid, description, from: 'wikidata'});
        }
    }
    return out;
};

const out = [];
for (const {id, kind} of BRIEFINGS) {
    const t = Date.now();
    const {rows: [b]} = await client.query(`select b.id, b.id_profile, b.created_at, b.items, p.name, p.text, p.languages
        from briefings b join user_profiles p on p.id = b.id_profile where b.id = $1`, [id]);
    const language = readerLanguage({text: b.text, languages: b.languages});
    const items = b.items.filter(item => item.summary);

    // every page of the briefing read in one go
    const articlesOf = (item) => {
        const lead = item.lead ?? item.articles?.[0];
        const others = (item.articles ?? []).filter(a => a.url !== lead?.url);
        return [lead, ...others].filter(Boolean).slice(0, MAX_ARTICLES);
    };
    const urls = [...new Set(items.flatMap(item => articlesOf(item).map(a => a.url)))];
    const pages = new Map((await Crawlers.Html(urls)).filter(p => p.content).map(p => [p.url, p]));

    // the thread timeline of every card
    const storyIds = items.map(item => item.storyId).filter(Number.isInteger);
    const {rows: earlier} = await client.query(`
        select s.id as card, o.id, o.created_at, o.lang,
          (select a.title from articles a where a.id_story = o.id order by coalesce(a.published_at, a.created_at) limit 1) as title,
          (select a.medium from articles a where a.id_story = o.id order by coalesce(a.published_at, a.created_at) limit 1) as medium
        from stories s join stories o on o.id_thread = s.id_thread and o.id <> s.id and o.created_at < $2
        where s.id = any($1) and s.id_thread is not null
        order by o.created_at desc`, [storyIds, b.created_at]);
    const timelineOf = new Map();
    for (const item of items) {
        const merged = new Set([item.storyId, ...(item.mergedStoryIds ?? [])]);
        const rows = earlier.filter(r => r.card === item.storyId && !merged.has(r.id) && r.title);
        const day = (d) => d.toISOString().slice(0, 10);
        const days = new Set(rows.filter(r => day(r.created_at) < day(b.created_at)).map(r => day(r.created_at))).size;
        timelineOf.set(item.storyId, {days, stories: rows.length,
            items: rows.slice(0, TIMELINE_MAX).reverse().map(r => ({date: day(r.created_at), title: r.title, lang: r.lang, medium: r.medium}))});
    }
    // titles not in the reader's language translated, the way the briefing translates titles
    const toTranslate = [...timelineOf.values()].flatMap(tl => tl.items).filter(x => x.lang !== language && writtenIn(x.lang));
    for (let i = 0; i < toTranslate.length; i += 25) {
        const part = toTranslate.slice(i, i + 25);
        const translations = await translateTexts(part.map(x => ({text: x.title, from: writtenIn(x.lang)})), writtenIn(language));
        part.forEach((x, j) => { x.titleTranslation = translations[j]; });
    }

    const qids = [...new Set(items.flatMap(item => (item.names ?? []).map(n => n.qid).filter(Boolean)))];
    const described = await descriptions(qids, language);

    const cards = items.map((item, i) => {
        const read = articlesOf(item).map((a, k) => {
            const page = pages.get(a.url);
            const sentences = page ? sentencesOf(page) : [];
            if (sentences.length >= 3) return {...a, sentences, read: true};
            // the lead not read again: its key passages, as the card shows them
            if (k === 0) return {...a, sentences: splitSentences(item.summary).map(text => ({text, quote: false})), read: false};
            return null;
        }).filter(Boolean);
        const [lead, ...others] = read;
        const othersKept = others.map(a => ({...a, sentences: fitted(a.sentences, OTHER_MAX)}));
        const leadChars = Math.max(LEAD_MIN, CARD_CHARS - othersKept.reduce((n, a) => n + size(a.sentences), 0));
        const articles = [];
        let used = 0;
        for (const a of [lead && {...lead, sentences: fitted(lead.sentences, leadChars)}, ...othersKept].filter(Boolean)) {
            if (articles.length > 0 && used + size(a.sentences) > CARD_CHARS + 500) {
                const left = CARD_CHARS - used;
                if (left < 800) break;
                a.sentences = fitted(a.sentences, left);
            }
            used += size(a.sentences);
            articles.push({url: a.url, source: a.source, title: a.title, language: a.language, publishedAt: a.publishedAt, read: a.read,
                sentences: a.sentences.map(s => s.quote ? `“${s.text}”` : s.text)});
        }
        return {
            n: i + 1, storyId: item.storyId, title: item.title, titleTranslation: item.titleTranslation ?? null,
            medium: item.lead?.source ?? item.articles?.[0]?.source ?? null, media: item.corroboration?.media ?? null,
            language: item.language ?? null, interest: item.interest ?? null,
            passages: item.summary, translation: item.translation ?? null,
            articles,
            timeline: timelineOf.get(item.storyId) ?? {days: 0, stories: 0, items: []},
            angles: (item.angles ?? []).map(a => ({source: a.source, title: a.title, titleTranslation: a.titleTranslation ?? null, publishedAt: a.publishedAt})),
            contested: (item.contested ?? []).map(c => ({sentence: c.sentence, translation: c.translation ?? null, source: c.source ?? null})),
            official: (item.official ?? []).map(o => ({party: o.party, title: o.title, channel: o.channel, publishedAt: o.publishedAt})),
            names: (item.names ?? []).map(n => ({name: n.name, kind: n.kind, qid: n.qid, ...(n.qid && described.get(n.qid) ? {description: described.get(n.qid).description} : {})})),
        };
    });
    out.push({id: b.id, profile: b.id_profile, name: b.name, kind, language, createdAt: b.created_at, cards});
    const readLeads = cards.filter(c => c.articles[0]?.read).length;
    const chars = cards.map(c => c.articles.reduce((n, a) => n + a.sentences.join(' ').length, 0));
    console.log(`${id} ${b.name} ${language}: ${cards.length} cards, leads read again ${readLeads}, articles ${cards.reduce((n, c) => n + c.articles.length, 0)}, `
        + `chars/card ${Math.round(chars.reduce((a, c) => a + c, 0) / cards.length)} (max ${Math.max(...chars)}), with history ${cards.filter(c => c.timeline.days > 0).length}, `
        + `angles ${cards.filter(c => c.angles.length).length}, contested ${cards.filter(c => c.contested.length).length}, official ${cards.filter(c => c.official.length).length}, `
        + `described names ${cards.reduce((n, c) => n + c.names.filter(x => x.description).length, 0)}, ${Math.round((Date.now() - t) / 1000)} s`);
}
await client.end();
fs.mkdirSync(new URL('./data/card-analysis/', import.meta.url), {recursive: true});
fs.writeFileSync(new URL('./data/card-analysis/cards.json', import.meta.url), JSON.stringify(out, null, 1));
process.exit(0);
