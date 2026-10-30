// Read only: an "Official" badge measured before building it. A card is confirmed when a party it is
// about (the person, the club, the body) says it on a channel of its own. For each card of the
// briefings of the last days:
//   1. the AI names the kind of news (a claim not yet official, an announcement already made, a public
//      event, an analysis) and the parties that could confirm or deny it themselves,
//   2. each party is found in Wikidata (search, the AI picks the item), with its official channels:
//      website P856, X P2002, Instagram P2003, Facebook P2013, YouTube P2397, TikTok P7085,
//      Mastodon P4033, Bluesky P12361, Telegram P3789,
//   3. the channels that can be read without a paid API are read: the website through its feed (and
//      the news of it our database already holds), YouTube and Mastodon through their feeds, Bluesky
//      through its public API. X, Instagram, Facebook, TikTok and Telegram are only counted,
//   4. the posts of the card's parties sharing names or words with it are judged by the AI against the
//      card: confirms / denies / related / other. One call per card that has some.
// The full entity integration (an entity model on every news, see the decision log) would give step 1
// and 2 at ingestion; here they are asked per card, as a briefing could. Nothing is written in the
// database. Steps 1-3 are kept in bench/data/official-badge/ and reused (delete a file to redo it).
// Result: bench/data/official-badge.txt
// With --bridge (in the api container, where RSS-Bridge answers) a site with no feed is read through
// the bridge too; its posts and result are kept apart (posts-bridge.json, official-badge-bridge.txt).
// With --entities the parties Wikidata did not find are searched again under other names the AI gives
// (English, short, original): the best an entity model linking every name to Wikidata could do. Kept
// apart too (items-again.json, official-badge-entities.txt).
// With --self the cards whose lead a party published on its own site are judged: is it the party
// itself making the fact official? (official-badge-...-self.txt)
// Both runs leave out YouTube and a party whose own site published the card's lead (self-publication).
//   node --env-file=.env bench/official-badge.mjs [profileIds=7,8,137,242] [days=7] [--bridge] [--entities] [--self]
import process from 'node:process';
import fs from 'node:fs';
import pg from 'pg';
import {newUsage, ollamaJson} from '../services/utils/ollama.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';
import {searchItems} from '../services/utils/wikidata.js';
import {findFeeds} from '../services/utils/feed-finder.js';
import {Crawlers} from '../services/utils/crawlers.js';

const BRIDGE = process.argv.includes('--bridge');
const ENTITIES = process.argv.includes('--entities');
const SELF = process.argv.includes('--self');
const args = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const SUFFIX = (BRIDGE ? '-bridge' : '') + (ENTITIES ? '-entities' : '') + (SELF ? '-self' : '');
const profileIds = (args[0] ?? '7,8,137,242').split(',').map(Number);
const DAYS = Number(args[1] ?? 7);
const MAX_PARTIES = 4;
const MAX_CANDIDATES = 10;          // posts judged per card
const BEFORE_DAYS = 5;              // a post this long before the card's first news still counts
const DIR = new URL('./data/official-badge/', import.meta.url);
fs.mkdirSync(DIR, {recursive: true});
const cached = async (name, make) => {
    const file = new URL(name, DIR);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    const value = await make();
    fs.writeFileSync(file, JSON.stringify(value, null, 1));
    return value;
};
const usage = newUsage();
// Wikidata answers "too many requests" to a few calls at once: one at a time, asked again after a wait
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const politely = async (call) => {
    for (let attempt = 0; ; attempt++) {
        try {
            await pause(250);
            return await call();
        } catch (err) {
            if (attempt >= 4) throw err;
            await pause(5000 * (attempt + 1));
        }
    }
};
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});

// ---- the cards
const {rows: briefings} = await pool.query(`SELECT id_profile, created_at, items FROM briefings
    WHERE id_profile = ANY($1) AND status = 'ready' AND created_at > now() - make_interval(days => $2)
    ORDER BY created_at DESC`, [profileIds, DAYS]);
const cards = [];
const seen = new Set();
for (const briefing of briefings) {
    for (const item of briefing.items ?? []) {
        if (!item.storyId || seen.has(item.storyId)) continue;
        seen.add(item.storyId);
        const dates = (item.articles ?? []).map(article => Date.parse(article.publishedAt)).filter(Number.isFinite);
        cards.push({
            id: String(item.storyId), profile: briefing.id_profile, title: item.title,
            translation: item.titleTranslation ?? null,
            titles: [...new Set((item.articles ?? []).map(article => article.title).filter(t => t && t !== item.title))].slice(0, 4),
            digest: String(item.digest ?? item.summary ?? '').slice(0, 700),
            language: item.language ?? 'en',
            lead: [item.lead?.url, item.lead?.source ? `https://${item.lead.source}` : null].filter(Boolean),
            first: dates.length ? new Date(Math.min(...dates)).toISOString() : briefing.created_at.toISOString(),
        });
    }
}
// --self judges the cards measured before (parties.json) again, the ones of later briefings left out
if (SELF && fs.existsSync(new URL('parties.json', DIR))) {
    const measured = JSON.parse(fs.readFileSync(new URL('parties.json', DIR), 'utf8'));
    cards.splice(0, cards.length, ...cards.filter(card => measured[card.id]));
}
console.log(`${cards.length} cards of ${briefings.length} briefings`);

// ---- 1. kind and parties, one call per card
const partiesPrompt = (card) => `A news card: "${card.title}"${card.translation ? ` (${card.translation})` : ''}
${card.titles.length ? `Its other articles title it: ${card.titles.map(t => `"${t}"`).join('; ')}\n` : ''}What it says: ${card.digest}

1. What kind of news is it?
"claim": a fact not yet made official by the ones concerned: a report, a rumour, a leak, "according to",
  talks, "set to", "close to", an accusation, what a third party says of someone.
"announced": the card tells what the ones concerned already said or published themselves: an official
  announcement, a statement, a press release, a press conference, a decision published by a body.
"event": a public fact anyone saw: a match result, an election result, a vote, an accident, a ceremony.
"analysis": an opinion, a preview, a guide, a feature, a review, a profile with no new fact.
2. The parties that could confirm or deny this fact themselves, on a channel of their own (website,
  social network): the person it is about, the club, company, body or government concerned, the
  person quoted. Not the media, not a journalist, not a country as a whole. At most ${MAX_PARTIES}, the most
  concerned first, each with its usual full name and what it is ("French footballer", "football club").
  None for an analysis or when no one could.
Answer in JSON only: {"kind": "claim", "parties": [{"name": "Bradley Barcola", "what": "French footballer"}]}`;

const askParties = async (list) => {
    const results = await mapWithConcurrency(list, 5, async (card) => {
        const answer = await ollamaJson(partiesPrompt(card), usage);
        return {kind: String(answer?.kind ?? 'none'),
            parties: (Array.isArray(answer?.parties) ? answer.parties : []).slice(0, MAX_PARTIES)
                .filter(party => party?.name).map(party => ({name: String(party.name), what: String(party.what ?? '')}))};
    });
    return Object.fromEntries(list.map((card, i) => [card.id, results[i].status === 'fulfilled' ? results[i].value : {kind: 'failed', parties: []}]));
};
const parties = await cached('parties.json', () => askParties(cards));
const newCards = cards.filter(card => !parties[card.id]);
if (newCards.length) {
    Object.assign(parties, await askParties(newCards));
    fs.writeFileSync(new URL('parties.json', DIR), JSON.stringify(parties, null, 1));
    console.log(`${newCards.length} new cards asked; their parties not yet in items.json count as not found`);
}

// ---- 2. the Wikidata item of each party: searched, then picked by the AI among the answers
const pickPrompt = (asked) => `For each name, the Wikidata item that is it, among the ones found. "none" when none is.
${asked.map((party, i) => `[${i + 1}] ${party.name} (${party.what}):
${party.found.map(item => `   ${item.qid}: ${item.label}${item.description ? ` - ${item.description}` : ''}`).join('\n')}`).join('\n')}
Answer in JSON only: {"items": [{"n": 1, "qid": "Q123"}]}`;

const items = await cached('items.json', async () => {
    const found = new Map();
    const names = [...new Map(Object.values(parties).flatMap(p => p.parties).map(party => [`${party.name}|${party.what}`, party])).values()];
    await mapWithConcurrency(names, 1, async (party) => {
        const list = await politely(() => searchItems(party.name, 'en')).catch(() => []);
        found.set(`${party.name}|${party.what}`, {...party, found: list.slice(0, 5)});
    });
    const asked = [...found.values()].filter(party => party.found.length > 0);
    const picks = {};
    const chunks = [];
    for (let i = 0; i < asked.length; i += 15) chunks.push(asked.slice(i, i + 15));
    await mapWithConcurrency(chunks, 4, async (chunk) => {
        const answer = await ollamaJson(pickPrompt(chunk), usage);
        for (const pick of Array.isArray(answer?.items) ? answer.items : []) {
            const party = chunk[Number(pick?.n) - 1];
            const item = party?.found.find(candidate => candidate.qid === pick?.qid);
            if (party && item) picks[`${party.name}|${party.what}`] = item;
        }
    });
    return picks;
});

// ---- 2b. (--entities) the parties not found, searched again under the other names the AI gives
const againPrompt = (asked) => `For each name of an organisation or a person, the other names it is known by:
its full official name in English, its short name or acronym, its full name in its own language.
${asked.map((party, i) => `[${i + 1}] ${party.name} (${party.what})`).join('\n')}
Answer in JSON only: {"names": [{"n": 1, "other": ["Italian National Olympic Committee", "CONI", "Comitato Olimpico Nazionale Italiano"]}]}`;
const keyOf = (party) => `${party.name}|${party.what}`;
if (ENTITIES) {
    const again = await cached('items-again.json', async () => {
        const lost = [...new Map(Object.values(parties).flatMap(p => p.parties).filter(party => !items[keyOf(party)])
            .map(party => [keyOf(party), party])).values()];
        const others = new Map();
        const chunks = [];
        for (let i = 0; i < lost.length; i += 20) chunks.push(lost.slice(i, i + 20));
        for (const chunk of chunks) {
            const answer = await ollamaJson(againPrompt(chunk), usage);
            for (const row of Array.isArray(answer?.names) ? answer.names : []) {
                const party = chunk[Number(row?.n) - 1];
                if (party && Array.isArray(row.other)) others.set(keyOf(party), row.other.map(String).slice(0, 3));
            }
        }
        const found = [];
        await mapWithConcurrency(lost, 1, async (party) => {
            const lists = [];
            for (const name of [party.name, ...(others.get(keyOf(party)) ?? [])]) {
                lists.push(...await politely(() => searchItems(name, 'en')).catch(() => []));
            }
            const unique = [...new Map(lists.map(item => [item.qid, item])).values()].slice(0, 8);
            if (unique.length) found.push({...party, found: unique});
        });
        const picks = {};
        for (let i = 0; i < found.length; i += 15) {
            const chunk = found.slice(i, i + 15);
            const answer = await ollamaJson(pickPrompt(chunk), usage);
            for (const pick of Array.isArray(answer?.items) ? answer.items : []) {
                const party = chunk[Number(pick?.n) - 1];
                const item = party?.found.find(candidate => candidate.qid === pick?.qid);
                if (party && item) picks[keyOf(party)] = {...item, again: true};
            }
        }
        console.log(`searched again: ${lost.length} parties, ${Object.keys(picks).length} found`);
        return picks;
    });
    Object.assign(items, again);
}

// ---- the official channels of each item
const CHANNELS = {site: 'P856', x: 'P2002', instagram: 'P2003', facebook: 'P2013', youtube: 'P2397', tiktok: 'P7085',
    mastodon: 'P4033', bluesky: 'P12361', telegram: 'P3789'};
// YouTube left out (user, 12.10.2026): a video gives only its title, no statement of the fact. Its
// 2 "confirms" of the first run were both wrong (a goal video for a card on the player's tears, a talk
// of Atlassian for its product launch), it brought no right one
const READABLE = ['site', 'mastodon', 'bluesky'];
const HEADERS = {'User-Agent': 'NewsGenerator/1.0 (self-hosted news reader)', Accept: 'application/json'};
const readClaims = async (qids) => {
    const out = {};
    for (let i = 0; i < qids.length; i += 40) {
        const ids = qids.slice(i, i + 40).join('|');
        const answer = await politely(async () => (await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids}&props=claims&format=json`,
            {headers: HEADERS})).json());
        for (const [qid, entity] of Object.entries(answer.entities ?? {})) {
            out[qid] = Object.fromEntries(Object.entries(CHANNELS).map(([name, property]) =>
                [name, (entity.claims?.[property] ?? []).filter(claim => claim.rank !== 'deprecated')
                    .map(claim => claim.mainsnak?.datavalue?.value).filter(value => typeof value === 'string')])
                .filter(([, values]) => values.length > 0));
        }
    }
    return out;
};
const channels = await cached('channels.json', () => readClaims([...new Set(Object.values(items).map(item => item.qid))]));
const missingQids = [...new Set(Object.values(items).map(item => item.qid))].filter(qid => !channels[qid]);
if (missingQids.length) {
    Object.assign(channels, await readClaims(missingQids));
    fs.writeFileSync(new URL('channels.json', DIR), JSON.stringify(channels, null, 1));
}

// ---- 3. the posts of the readable channels: [{channel, at, title, text, url}]
const oldest = new Date(Math.min(...cards.map(card => Date.parse(card.first))) - BEFORE_DAYS * 864e5);
const mediumOf = (url) => {
    const host = (url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/:?#]+)/i)?.[1] ?? '').toLowerCase();
    return host.match(/([^.]+[.](?:(?:co|com|org|net|ac|gov|edu)[.][a-z]{2}|[^.]+))$/)?.[1] ?? host;
};
const fromFeed = (channel, items) => items.map(item => ({channel, at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
    title: String(item.title ?? '').trim(), text: String(item.description ?? item.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300),
    url: item.link}));

const readChannels = async (qid, list) => {
    const posts = [];
    const notes = [];
    const site = list.site?.[0];
    if (site) {
        // what our feeds already read of the site, then the site's own feed read now
        const {rows} = await pool.query(`SELECT title, description, link, published_at FROM articles
            WHERE medium = $1 AND created_at > $2 ORDER BY published_at DESC NULLS LAST LIMIT 300`, [mediumOf(site), oldest]);
        posts.push(...rows.map(row => ({channel: 'site(db)', at: row.published_at?.toISOString() ?? null, title: row.title,
            text: String(row.description ?? '').slice(0, 300), url: row.link})));
        try {
            const feeds = await Promise.race([findFeeds(site, {bridge: BRIDGE}), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 45e3))]);
            if (feeds.length) {
                const [feed] = await Crawlers.Xml([{url: feeds[0].url}]);
                posts.push(...fromFeed(feeds[0].pattern ? 'site(bridge)' : 'site', feed.items ?? []));
                notes.push(`site ${feeds[0].pattern ? 'bridge' : 'feed'} ${feeds[0].pattern ? new URL(site).host : feeds[0].url} ${feed.items?.length ?? 0}`);
            } else notes.push('site: no feed');
        } catch (err) { notes.push(`site: ${err.message}`); }
        if (rows.length) notes.push(`site in db ${rows.length}`);
    }
    if (list.mastodon?.[0]) {
        const [user, instance] = list.mastodon[0].replace(/^@/, '').split('@');
        if (user && instance) {
            const [feed] = await Crawlers.Xml([{url: `https://${instance}/@${user}.rss`}]);
            posts.push(...fromFeed('mastodon', feed.items ?? []));
            notes.push(`mastodon ${feed.items?.length ?? feed.error}`);
        }
    }
    if (list.bluesky?.[0]) {
        try {
            const answer = await (await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(list.bluesky[0])}&limit=60&filter=posts_no_replies`,
                {signal: AbortSignal.timeout(15e3)})).json();
            const feed = (answer.feed ?? []).filter(entry => !entry.reason);
            posts.push(...feed.map(entry => ({channel: 'bluesky', at: entry.post?.record?.createdAt ?? null, title: '',
                text: String(entry.post?.record?.text ?? '').slice(0, 300),
                url: `https://bsky.app/profile/${list.bluesky[0]}/post/${String(entry.post?.uri ?? '').split('/').pop()}`})));
            notes.push(`bluesky ${feed.length}`);
        } catch (err) { notes.push(`bluesky: ${err.message}`); }
    }
    return {posts: posts.filter(post => post.title || post.text), notes};
};

// the posts of a run with the entities are the ones of the run without, plus the new items'
const postsFile = `posts${BRIDGE ? '-bridge' : ''}.json`;
const posts = await cached(postsFile, async () => {
    const out = {};
    const list = Object.entries(channels).filter(([, found]) => READABLE.some(name => found[name]));
    const results = await mapWithConcurrency(list, 4, ([qid, found]) => readChannels(qid, found));
    list.forEach(([qid], i) => { out[qid] = results[i].status === 'fulfilled' ? results[i].value : {posts: [], notes: [String(results[i].reason)]}; });
    return out;
});
const unread = Object.entries(channels).filter(([qid, found]) => !posts[qid] && READABLE.some(name => found[name]));
if (unread.length) {
    const results = await mapWithConcurrency(unread, 4, ([qid, found]) => readChannels(qid, found));
    unread.forEach(([qid], i) => { posts[qid] = results[i].status === 'fulfilled' ? results[i].value : {posts: [], notes: [String(results[i].reason)]}; });
    fs.writeFileSync(new URL(postsFile, DIR), JSON.stringify(posts, null, 1));
}

// ---- 3b. (--self) the cards whose lead the party published on its own site. Left out so far
// ("nothing confirmed"), but the reader would see at a glance it is the party's own word (user,
// 13.10.2026). Its site may tell what another one did, though: the AI says whether the party makes
// the main fact official itself, twice (the answers listed in another order), "own" both times counts
const ownPrompt = (card, party, order) => `An article published on the official website of ${party.item.label} (${party.what}): "${card.title}"${card.translation ? ` (${card.translation})` : ''}
What it says: ${card.digest}

Who is making its main fact official?
${order.map(kind => ({
    own: `"own": ${party.item.label} itself: its own decision, announcement, appointment, signing, figure, result or
  statement (or of its own players, members, staff).`,
    reports: `"reports": it tells what another one decided, did or said, a rumour, or a fact it is not the author of.`,
    other: `"other": a preview, an interview, an analysis, a feature, with no new fact.`,
}[kind])).join('\n')}
Answer in JSON only: {"kind": "${order[0]}"}`;
if (SELF) {
    const before = new Set([...fs.readFileSync(new URL(`./data/official-badge${SUFFIX.replace('-self', '')}.txt`, import.meta.url), 'utf8')
        .matchAll(/^#(\d+) \[[^\]]*\] CONFIRMS/gm)].map(match => match[1]));
    const selfLines = [];
    const counts = {cards: 0, own: 0, reports: 0, other: 0, unstable: 0, gained: 0, byKind: {}};
    const judged = await mapWithConcurrency(cards, 3, async (card) => {
        const {kind, parties: list} = parties[card.id];
        const leadMedia = new Set(card.lead.map(mediumOf));
        const own = list.map(party => ({...party, item: items[keyOf(party)] ?? null}))
            .filter(party => party.item && (channels[party.item.qid]?.site ?? []).some(site => leadMedia.has(mediumOf(site))));
        const answers = [];
        for (const party of own.slice(0, 1)) {
            const first = await ollamaJson(ownPrompt(card, party, ['own', 'reports', 'other']), usage);
            const second = await ollamaJson(ownPrompt(card, party, ['other', 'reports', 'own']), usage);
            answers.push({party, first: String(first?.kind), second: String(second?.kind)});
        }
        return {kind, answers};
    });
    cards.forEach((card, i) => {
        const {kind, answers} = judged[i].status === 'fulfilled' ? judged[i].value : {kind: 'failed', answers: []};
        if (answers.length === 0) return;
        counts.cards++;
        const [{party, first, second}] = answers;
        const verdict = first === second ? first : 'unstable';
        counts[verdict] = (counts[verdict] ?? 0) + 1;
        if (verdict === 'own') {
            counts.byKind[kind] = (counts.byKind[kind] ?? 0) + 1;
            if (!before.has(card.id)) counts.gained++;
        }
        selfLines.push(`\n#${card.id} [p${card.profile} ${kind}] ${verdict.toUpperCase()}${before.has(card.id) ? ' (had a badge)' : ''} ${party.item.label}: ${card.title}${card.translation ? ` (${card.translation})` : ''}`
            + `\n    ${first} / ${second} <${card.lead[0]}>\n    ${card.digest.slice(0, 220)}`);
    });
    const selfHead = [`--self: ${cards.length} cards, ${counts.cards} published by a party on its own site; "own" twice on ${counts.own} ${JSON.stringify(counts.byKind)}, `
        + `"reports" ${counts.reports}, "other" ${counts.other}, unstable ${counts.unstable}; badges gained ${counts.gained} (cards with none before)`,
        `tokens ${JSON.stringify(usage)}`].join('\n');
    fs.writeFileSync(new URL(`./data/official-badge${SUFFIX}.txt`, import.meta.url), selfHead + '\n' + selfLines.join('\n') + '\n');
    console.log(selfHead);
    await pool.end();
    process.exit(0);
}

// ---- 4. the posts close to the card, judged by the AI
const plain =(text) => String(text ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const wordsOf = (text) => new Set(plain(text).split(/[^a-z0-9]+/).filter(word => word.length >= 4));
const STOP = new Set(['with', 'that', 'this', 'from', 'after', 'avec', 'pour', 'dans', 'contre', 'apres', 'their', 'have', 'will', 'about', 'what', 'sans', 'plus', 'more', 'over', 'into', 'sont', 'est']);

const checkPrompt = (card, list) => `A news card: "${card.title}"${card.translation ? ` (${card.translation})` : ''}
What it says: ${card.digest}

Posts published by the parties concerned themselves, on their own official channels:
${list.map((post, i) => `[${i + 1}] ${post.party}, ${post.at?.slice(0, 10) ?? 'no date'}: ${[post.title, post.text].filter(Boolean).join(' - ').slice(0, 400)}`).join('\n')}

For each post, in any language, what it is to the card:
"confirms": the post itself states the card's main fact (the same transfer, appointment, decision,
  figure, result), so the party made it official. Only the main fact, not a detail around it.
"denies": the post says the card's main fact is false, or states a different outcome of it.
"related": the same person, club or affair, but not the card's fact (another match, another signing,
  a reaction, a preview, a picture with no statement of it).
"other": anything else, or too vague to tell.
Answer in JSON only: {"posts": [{"n": 1, "kind": "related"}]}`;

const lines = [];
const stats = {cards: cards.length, kinds: {}, withParty: 0, withItem: 0, withReadable: 0, withOnlyClosed: 0, withNoChannel: 0,
    asked: 0, confirms: 0, denies: 0, confirmsByKind: {}, channelOfConfirms: {}};
const verdicts = await mapWithConcurrency(cards, 4, async (card) => {
    const {kind, parties: list} = parties[card.id];
    const resolved = list.map(party => ({...party, item: items[`${party.name}|${party.what}`] ?? null}));
    const from = Date.parse(card.first) - BEFORE_DAYS * 864e5;
    const cardWords = new Set([...wordsOf(`${card.title} ${card.translation ?? ''} ${card.titles.join(' ')}`)].filter(word => !STOP.has(word)));
    const names = resolved.map(party => party.item?.label ?? party.name);
    const candidates = [];
    const leadMedia = new Set(card.lead.map(mediumOf));
    for (const party of resolved) {
        if (!party.item) continue;
        // the card's lead published by the party itself confirms nothing
        if ((channels[party.item.qid]?.site ?? []).some(site => leadMedia.has(mediumOf(site)))) continue;
        for (const post of posts[party.item.qid]?.posts ?? []) {
            if (post.channel === 'youtube') continue;
            if (post.at && Date.parse(post.at) < from) continue;
            const words = wordsOf(`${post.title} ${post.text}`);
            const otherNames = names.filter(name => name !== party.item.label && [...wordsOf(name)].some(word => words.has(word))).length;
            const shared = [...cardWords].filter(word => words.has(word)).length;
            if (otherNames + shared < 2) continue;
            candidates.push({...post, party: party.item.label, score: otherNames * 2 + shared});
        }
    }
    const unique = [...new Map(candidates.map(post => [post.url ?? post.title, post])).values()]
        .sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES);
    let kinds = [];
    if (unique.length) {
        const answer = await ollamaJson(checkPrompt(card, unique), usage);
        const by = new Map((Array.isArray(answer?.posts) ? answer.posts : []).map(item => [Number(item.n), String(item.kind)]));
        kinds = unique.map((post, i) => by.get(i + 1) ?? 'none');
    }
    return {resolved, unique, kinds, kind};
});

cards.forEach((card, i) => {
    const result = verdicts[i].status === 'fulfilled' ? verdicts[i].value : {resolved: [], unique: [], kinds: [], kind: 'failed'};
    const {resolved, unique, kinds, kind} = result;
    stats.kinds[kind] = (stats.kinds[kind] ?? 0) + 1;
    if (resolved.length) stats.withParty++;
    if (resolved.some(party => party.item)) stats.withItem++;
    const found = resolved.filter(party => party.item).map(party => channels[party.item.qid] ?? {});
    const readable = found.some(list => READABLE.some(name => list[name]));
    if (readable) stats.withReadable++;
    else if (found.some(list => Object.keys(list).length)) stats.withOnlyClosed++;
    else if (resolved.some(party => party.item)) stats.withNoChannel++;
    if (unique.length) stats.asked++;
    const confirmed = kinds.includes('confirms'), denied = kinds.includes('denies');
    if (confirmed && unique.some((post, j) => kinds[j] === 'confirms' && resolved.find(party => party.item?.label === post.party)?.item?.again)) stats.viaAgain = (stats.viaAgain ?? 0) + 1;
    if (confirmed) {
        stats.confirms++;
        stats.confirmsByKind[kind] = (stats.confirmsByKind[kind] ?? 0) + 1;
        for (const post of unique.filter((post, j) => kinds[j] === 'confirms')) stats.channelOfConfirms[post.channel] = (stats.channelOfConfirms[post.channel] ?? 0) + 1;
    }
    if (denied) stats.denies++;

    lines.push(`\n#${card.id} [p${card.profile} ${kind} ${card.first.slice(0, 10)}]${confirmed ? ' CONFIRMS' : ''}${denied ? ' DENIES' : ''} ${card.title}${card.translation ? ` (${card.translation})` : ''}`);
    for (const party of resolved) {
        const list = party.item ? channels[party.item.qid] ?? {} : {};
        const kindsOf = Object.keys(list).map(name => READABLE.includes(name) ? name : `(${name})`).join(' ');
        const read = party.item ? posts[party.item.qid] : null;
        lines.push(`  party ${party.name} (${party.what}) -> ${party.item ? `${party.item.qid} ${party.item.label} - ${party.item.description ?? ''}` : 'NOT FOUND'}`
            + (party.item ? ` | ${kindsOf || 'no channel'}${read ? ` | ${read.posts.length} posts; ${read.notes.join('; ')}` : ''}` : ''));
    }
    unique.forEach((post, j) => lines.push(`    ${kinds[j].padEnd(9)} ${post.channel} ${post.party} ${post.at?.slice(0, 10) ?? '?'}: ${[post.title, post.text].filter(Boolean).join(' - ').slice(0, 200)}  <${post.url}>`));
});

const resolved2 = () => `${Object.values(items).filter(item => item.again).length} parties`;
const pct = (n) => `${n} (${Math.round(100 * n / (stats.cards || 1))}%)`;
const head = [
    `profiles ${profileIds} ${DAYS} d: ${stats.cards} cards; kinds ${JSON.stringify(stats.kinds)}`,
    `with a party ${pct(stats.withParty)}, one found in Wikidata ${pct(stats.withItem)}, a readable channel ${pct(stats.withReadable)}, `
        + `only closed channels (X, Instagram...) ${pct(stats.withOnlyClosed)}, no channel at all ${pct(stats.withNoChannel)}`,
    `posts judged on ${pct(stats.asked)} cards: AI "confirms" on ${pct(stats.confirms)} ${JSON.stringify(stats.confirmsByKind)} via ${JSON.stringify(stats.channelOfConfirms)}, "denies" on ${pct(stats.denies)}`,
    `found again ${resolved2(stats)}; confirms through a party found only by the second search: ${stats.viaAgain ?? 0}`,
    `tokens of this run ${JSON.stringify(usage)}`,
].join('\n');
fs.writeFileSync(new URL(`./data/official-badge${SUFFIX}.txt`, import.meta.url), head + '\n' + lines.join('\n') + '\n');
console.log(head);
await pool.end();
process.exit(0);
