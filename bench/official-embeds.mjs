// Read only: two more ways to the "Official source" of a card, measured on the 163 cards of
// bench/official-badge.mjs (its parties, Wikidata items and channels reused from bench/data/official-badge/):
//   A. a post of one of the card's parties EMBEDDED in one of its articles (X, Instagram, Facebook,
//      TikTok, Bluesky, Threads): the account of the post matched with the party's accounts in Wikidata.
//      X and Instagram can't be read, but the media embed the post that made the news official
//   B. (D in the discussion) a sentence of one of its articles REPORTING the party's own statement ("in a
//      statement", "confirmed on Instagram", "a annoncé dans un communiqué"), read by the AI as
//      Contested reads a denial: who says it, whether it is the party the news is about, whether it
//      confirms the card's news itself
// The articles of each card are read as the briefing reads them (5 at most, one per medium, the lead
// first), the page kept before Readability for the embeds. Pages kept in bench/data/official-embeds/.
// Result: bench/data/official-embeds.txt, compared with the badges of the run with the entities
// (official-badge-bridge-entities.txt). Judged by hand after.
//   node --env-file=.env bench/official-embeds.mjs
import fs from 'node:fs';
import pg from 'pg';
import {Readability} from '@mozilla/readability';
import {parseHTML} from 'linkedom';
import {blocksOf} from '../services/utils/crawlers.js';
import {discardBody, fetchPublicUrl, guardFetch, readText} from '../services/utils/public-url.js';
import {sentencesOf} from '../services/utils/extract.js';
import {languageOf} from '../services/utils/language.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';
import {newUsage, ollamaJson} from '../services/utils/ollama.js';

guardFetch();
const OLD = new URL('./data/official-badge/', import.meta.url);
const DIR = new URL('./data/official-embeds/', import.meta.url);
fs.mkdirSync(DIR, {recursive: true});
const read = (dir, name) => JSON.parse(fs.readFileSync(new URL(name, dir), 'utf8'));
const parties = read(OLD, 'parties.json');
const items = {...read(OLD, 'items.json'), ...read(OLD, 'items-again.json')};
const channels = read(OLD, 'channels.json');
const MAX_ARTICLES = 5;
const MAX_SENTENCES = 25;
const usage = newUsage();

// ---- the cards and their articles, as the briefings saved them
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
const {rows: briefings} = await pool.query(`SELECT items FROM briefings WHERE id_profile = ANY($1) AND status = 'ready'
    AND created_at BETWEEN '2026-10-04' AND '2026-10-13' ORDER BY created_at DESC`, [[7, 8, 137, 242]]);
const cards = new Map();
for (const briefing of briefings) for (const item of briefing.items ?? []) {
    const id = String(item.storyId);
    if (!parties[id] || cards.has(id)) continue;
    const media = new Set();
    const articles = [item.lead, ...(item.articles ?? [])].filter(article => article?.url && !/news\.google\.com/.test(article.url))
        .filter(article => !media.has(article.source) && media.add(article.source)).slice(0, MAX_ARTICLES);
    cards.set(id, {id, title: item.title, translation: item.titleTranslation ?? null, articles});
}
console.log(`${cards.size} of ${Object.keys(parties).length} cards found again`);

// ---- the pages: their embedded posts and their text
const HEADERS = {'User-Agent': 'Mozilla/5.0 (compatible; NewsGenerator/1.0; +RSS reader)',
    'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'fr,en;q=0.8,de;q=0.6,it;q=0.5,es;q=0.5'};
// the account and the address of a post, from a link: null for a share button, a profile, a hashtag
const POST = [
    [/^https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/\d+/i, 'x'],
    [/^https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_.]+)\/(?:p|reel|tv)\/[\w-]+/i, 'instagram'],
    [/^https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[\w-]+/i, 'instagram?'],
    [/^https?:\/\/(?:www\.|m\.)?facebook\.com\/([\w.-]+)\/(?:posts|videos|photos)\//i, 'facebook'],
    [/^https?:\/\/(?:www\.)?tiktok\.com\/@([\w.-]+)\/video\/\d+/i, 'tiktok'],
    [/^https?:\/\/bsky\.app\/profile\/([\w.-]+)\/post\/\w+/i, 'bluesky'],
    [/^https?:\/\/(?:www\.)?threads\.(?:net|com)\/@([\w.]+)\/post\//i, 'threads'],
];
const postOf = (url) => {
    for (const [pattern, network] of POST) {
        const match = String(url ?? '').match(pattern);
        if (match) return {network: network.replace('?', ''), account: match[1]?.toLowerCase() ?? null, url: match[0]};
    }
    return null;
};
// the posts embedded in a page: the links of its embed blocks (blockquote, iframe) and any link to a post,
// with the text the embed shows. An Instagram embed names its account in its text ("@uefa_official")
const embedsOf = (document) => {
    const found = new Map();
    const add = (url, text = '') => {
        const post = postOf(url);
        if (!post) return;
        if (!post.account && post.network === 'instagram') post.account = (text.match(/\(@([A-Za-z0-9_.]+)\)/)?.[1] ?? '').toLowerCase() || null;
        if (!found.has(post.url)) found.set(post.url, {...post, text: text.replace(/\s+/g, ' ').trim().slice(0, 400)});
    };
    for (const block of document.querySelectorAll('blockquote, .twitter-tweet, .instagram-media, .tiktok-embed, .fb-post')) {
        const text = block.textContent ?? '';
        for (const link of block.querySelectorAll('a[href]')) add(link.getAttribute('href'), text);
        for (const attribute of ['cite', 'data-instgrm-permalink', 'data-href']) if (block.getAttribute(attribute)) add(block.getAttribute(attribute), text);
    }
    for (const frame of document.querySelectorAll('iframe[src], iframe[data-src]')) add(frame.getAttribute('src') || frame.getAttribute('data-src'));
    for (const link of document.querySelectorAll('a[href]')) add(link.getAttribute('href'));
    return [...found.values()];
};
const readPage = async (url) => {
    try {
        const {res} = await fetchPublicUrl(url, {headers: HEADERS, timeoutMs: 20000, maxRedirects: 5});
        if (!res.ok) {
            await discardBody(res);
            return {url, error: `HTTP ${res.status}`};
        }
        const {document} = parseHTML(await readText(res, 20000));
        const embeds = embedsOf(document);
        const article = new Readability(document).parse();
        return {url, embeds, content: article?.textContent?.trim() ?? '', blocks: article ? blocksOf(article.content) : []};
    } catch (err) {
        return {url, error: err.message};
    }
};
const pagesFile = new URL('pages.json', DIR);
const pages = fs.existsSync(pagesFile) ? JSON.parse(fs.readFileSync(pagesFile, 'utf8')) : {};
const urls = [...new Set([...cards.values()].flatMap(card => card.articles.map(article => article.url)))].filter(url => !pages[url]);
console.log(`${urls.length} pages to read`);
await mapWithConcurrency(urls, 10, async (url) => {
    pages[url] = await readPage(url);
});
fs.writeFileSync(pagesFile, JSON.stringify(pages));

// ---- A. the embedded posts of the card's parties
const accountsOf = (card) => (parties[card.id]?.parties ?? []).map(party => {
    const item = items[`${party.name}|${party.what}`];
    return {party: party.name, qid: item?.qid ?? null, channels: item ? channels[item.qid] ?? {} : {}};
}).filter(party => party.qid);
const partyOfPost = (accounts, post) => accounts.find(party =>
    (party.channels[post.network === 'threads' ? 'instagram' : post.network] ?? []).some(handle => String(handle).toLowerCase() === post.account));

// ---- B. the sentences reporting a statement, one AI call per card that has some
const STATEMENT = new RegExp([
    // en
    String.raw`\bstatements?\b`, String.raw`\bpress release`, String.raw`\b(?:confirm|announc)\w*\b.{0,60}\b(?:website|on x\b|twitter|instagram|facebook|social media|tiktok|its channels)`,
    String.raw`\bofficially\b`, String.raw`\b(?:posted|wrote|said) on (?:x|twitter|instagram|facebook)\b`,
    // fr
    String.raw`communiqu[ée]`, String.raw`officialis`, String.raw`\b(?:a|ont) (?:confirmé|annoncé)`, String.raw`sur (?:son|ses|leur|leurs) (?:site|compte|réseaux)`,
    // es / pt
    String.raw`comunicado`, String.raw`oficializ`, String.raw`\b(?:confirmó|anunció|confirmou|anunciou)\b`, String.raw`nota oficial`, String.raw`(?:sus|suas) redes`,
    // it
    String.raw`comunicato`, String.raw`ufficializ`, String.raw`\bha (?:confermato|annunciato)\b`, String.raw`nota ufficiale`,
    // de / nl
    String.raw`Mitteilung`, String.raw`Stellungnahme`, String.raw`\b(?:bestätigte|gab .{0,40}bekannt|offiziell)\b`, String.raw`verklaring`, String.raw`\bbevestigde\b`, String.raw`persbericht`, String.raw`maakte .{0,40}bekend`,
].join('|'), 'iu');

const statementPrompt = (card, candidates, names) => `A news card: "${card.title}"${card.translation ? ` (${card.translation})` : ''}
The ones it is about: ${names.join(', ') || 'unknown'}.

Sentences of articles on it:
${candidates.map((candidate, i) => `[${i + 1}] (${candidate.source}) ${candidate.sentence}`).join('\n')}

For each sentence, in this order:
said_by: who makes the statement, announcement or post the sentence reports, by their name, "" when nobody named.
own: true when that one is one of the ones the news is about (the person, the club, the body, the company),
  speaking for itself: a statement, a release, its website, its own account, its press conference. false
  for a media, a journalist, an agent, a source, a third party, someone close to them.
confirms: true when what they said makes the news of the card itself official or confirms it, as its title
  tells it. false for another fact, a denial, a refusal to comment, "has not confirmed", "awaits
  confirmation", "expected to announce", an opinion.
Answer in JSON only: {"sentences": [{"n": 1, "said_by": "who", "own": true, "confirms": true}]}`;

const judged = await mapWithConcurrency([...cards.values()], 4, async (card) => {
    const accounts = accountsOf(card);
    const read = card.articles.map(article => ({article, page: pages[article.url]})).filter(({page}) => page && !page.error);
    const embeds = read.flatMap(({article, page}) => page.embeds.map(post => ({...post, source: article.source,
        party: partyOfPost(accounts, post)?.party ?? null})));
    const seen = new Set();
    const candidates = read.flatMap(({article, page}) => {
        const language = languageOf(page.content);
        return sentencesOf(page).filter(sentence => STATEMENT.test(sentence.text) && !seen.has(sentence.text) && seen.add(sentence.text))
            .map(sentence => ({sentence: sentence.text, source: article.source, language}));
    }).slice(0, MAX_SENTENCES);
    let statements = [];
    if (candidates.length > 0) {
        const answer = await ollamaJson(statementPrompt(card, candidates, (parties[card.id]?.parties ?? []).map(party => party.name)), usage);
        statements = (Array.isArray(answer?.sentences) ? answer.sentences : [])
            .map(read => ({...read, ...candidates[Number(read?.n) - 1]})).filter(read => read.sentence);
    }
    return {card, read: read.length, asked: card.articles.length, embeds, candidates: candidates.length, statements};
});
const done = judged.filter(result => result.status === 'fulfilled').map(result => result.value);

// ---- the badges of the run with the entities, by card
const before = new Set();
let current = null;
for (const line of fs.readFileSync(new URL('./data/official-badge-bridge-entities.txt', import.meta.url), 'utf8').split('\n')) {
    const head = line.match(/^#(\d+) /);
    if (head) current = head[1];
    else if (/^ {4}confirms /.test(line) && current) before.add(current);
}

const lines = [];
const pagesRead = done.reduce((n, r) => n + r.read, 0), pagesAsked = done.reduce((n, r) => n + r.asked, 0);
const withEmbed = done.filter(r => r.embeds.length > 0);
const withPartyEmbed = done.filter(r => r.embeds.some(post => post.party));
const confirmed = done.filter(r => r.statements.some(s => s.own === true && s.confirms === true));
const either = done.filter(r => r.embeds.some(post => post.party) || r.statements.some(s => s.own === true && s.confirms === true));
const kindOf = (r) => parties[r.card.id]?.kind ?? 'none';
const byKind = (list) => JSON.stringify(Object.fromEntries(['claim', 'announced', 'event', 'analysis'].map(k => [k, list.filter(r => kindOf(r) === k).length])));
lines.push(`${done.length} cards (failed ${judged.length - done.length}), pages read ${pagesRead} of ${pagesAsked}; kinds ${byKind(done)}`,
    `A. cards with an embedded post ${withEmbed.length}, of one of their parties ${withPartyEmbed.length} ${byKind(withPartyEmbed)}; posts ${done.reduce((n, r) => n + r.embeds.length, 0)} `
        + `(${JSON.stringify(Object.fromEntries(['x', 'instagram', 'facebook', 'tiktok', 'bluesky', 'threads'].map(k => [k, done.reduce((n, r) => n + r.embeds.filter(p => p.network === k).length, 0)])))})`,
    `B. cards with statement sentences ${done.filter(r => r.candidates > 0).length}, AI "own + confirms" ${confirmed.length} ${byKind(confirmed)}`,
    `A or B ${either.length}, of them without a badge in the entities run ${either.filter(r => !before.has(r.card.id)).length} (badges then: ${before.size})`,
    `tokens ${JSON.stringify(usage)}`, '');
for (const r of done) {
    const partyPosts = r.embeds.filter(post => post.party);
    const own = r.statements.filter(s => s.own === true && s.confirms === true);
    if (!partyPosts.length && !own.length) continue;
    lines.push(`#${r.card.id} [${kindOf(r)}${before.has(r.card.id) ? ' BADGE BEFORE' : ''}] ${r.card.title}${r.card.translation ? ` (${r.card.translation})` : ''}`);
    for (const post of partyPosts) lines.push(`  A ${post.party} ${post.network} @${post.account} in ${post.source}: ${post.url}\n      ${post.text.slice(0, 250)}`);
    for (const s of own) lines.push(`  B ${s.said_by} (${s.source}): ${s.sentence.slice(0, 300)}`);
}
lines.push('', '---- embedded posts of other accounts (not a party found), for a look');
for (const r of withEmbed) {
    const others = r.embeds.filter(post => !post.party);
    if (others.length) lines.push(`#${r.card.id} ${r.card.title.slice(0, 80)} | parties ${accountsOf(r.card).map(p => `${p.party} ${JSON.stringify({x: p.channels.x, ig: p.channels.instagram})}`).join('; ')}\n   ${others.map(p => `${p.network} @${p.account} (${p.source})`).join(', ')}`);
}
fs.writeFileSync(new URL('./data/official-embeds.txt', import.meta.url), lines.join('\n') + '\n');
console.log(lines.slice(0, 5).join('\n'));
await pool.end();
process.exit(0);
