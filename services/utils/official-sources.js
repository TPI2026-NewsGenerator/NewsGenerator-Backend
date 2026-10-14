//
//  Author: Fabian Rostello
//  Date: 12.10.2026
//  File: official-sources.js
//  Description: "Official source" of a card: the post where a party the news is about (a club, a body,
//               a company) says it itself, on its website or an open account of its own. The AI names
//               the parties, Wikidata gives their channels, the posts close to the card are judged by
//               the AI, twice
//

"use strict"

import {ollamaJson} from './ollama.js';
import {mapWithConcurrency} from './concurrency.js';
import {readChannels, searchItems} from './wikidata.js';
import {findFeeds} from './feed-finder.js';
import {Crawlers} from './crawlers.js';
import {hostOf, mediumOf} from './public-url.js';
import {statementsOf} from './statements.js';
import {translateTexts} from './extract.js';
import {writtenIn} from './language.js';
import {OfficialModel} from '../../models/official-model.js';
import {FeedModel} from '../../models/feed-model.js';
import {decodeLinks, isGoogleNewsUrl} from './google-news.js';
import {shortName} from './card-names.js';
import {mentionKey} from './mentions.js';

// Measured on 163 cards of four readers over 7 days (bench/official-badge.mjs, judged by hand): 19
// cards got a right official post, none a wrong one, 5 of them debatable (UEFA's "the 55 associations
// ask Čeferin" for "Latvia supports him"). They are announcements the media told after the party
// (UEFA, FIGC, Bundesliga, Microsoft), rarely a rumour made official later: the transfers are
// announced on X and Instagram, which can't be read without a paid access, and the sites of most big
// clubs publish no feed even through the bridge. Left out on purpose:
//  - YouTube: a video gives its title only, no statement; its 2 "confirms" were both wrong
//  - a denial: 5 found over three runs, all wrong ("elections by 31 January" for "on 14 December")
// A card whose lead the party published on its own site is judged like the others: its article is the
// best confirmation there is, seen at a glance (user, 13.10.2026). Left out at first, it was 2 cards of
// the 163 (bench/official-badge.mjs --self): the leads are nearly always a media's, a party's own news
// read by our feeds already joins a card as one of its articles
// One answer of the AI is not stable: the same three posts of UEFA were "confirms" in one run and
// "denies" in the next. A post counts only when two answers, the posts in another order, confirm it.
export const MAX_OFFICIAL = 2;              // posts shown on a card, of different parties
const MAX_PARTIES = 4;
const MAX_CANDIDATES = 10;                  // posts judged per card
const BEFORE_DAYS = 5;                      // a post this long before the card's first news still counts
const READABLE = ['site', 'mastodon', 'bluesky'];
// It runs beside the other angles (5 calls at a time): at 5 cards and their two checks at once, Ollama
// answered "too many concurrent requests", calls went to Gemini and the angles of a card were lost
const AI_CONCURRENCY = 3;
const CHANNEL_CONCURRENCY = 4;
const FEED_TIMEOUT_MS = 45e3;
const PICKS_PER_CALL = 15;
// Wikidata answers "too many requests" to a few searches at once (the first run of the bench lost
// nearly every name): one at a time, asked again after a wait
const SEARCH_PAUSE_MS = 250;
const SEARCH_WAITS_MS = [5e3, 10e3, 20e3];
// The first try on four briefings took 45 to 310 s, the names new to us searched one at a time and the
// feeds of new official sites looked for (45 s at most each); then 102 s of 134 went to the searches,
// waiting after Wikidata's 429s. A briefing searches for SEARCH_MS at most and stops at the first
// refusal, the names left are searched by the next ones; a site's feed is looked for apart, for the
// next briefing: the news of the site our feeds already read gave 31 of the 42 confirming posts measured
const MAX_SEARCHES = 30;
const SEARCH_MS = 20e3;

export const partiesPrompt = (card) => `A news card: "${card.title}"${card.titleTranslation ? ` (${card.titleTranslation})` : ''}
${card.titles?.length ? `Its other articles title it: ${card.titles.map(t => `"${t}"`).join('; ')}\n` : ''}What it says: ${card.text}

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
  concerned first, each with its usual full name, what it is ("French footballer", "football club"),
  and its other names: its full official name in English, its short name or acronym.
  None for an analysis or when no one could.
Answer in JSON only: {"kind": "claim", "parties": [{"name": "CONI", "what": "Italian Olympic committee", "other": ["Italian National Olympic Committee"]}]}`;

// {kind, parties: [{name, what, other}]}, the parties MAX_PARTIES at most, none for an analysis
export const normalizeParties = (answer) => {
    const kind = ['claim', 'announced', 'event', 'analysis'].includes(answer?.kind) ? answer.kind : 'none';
    const parties = kind === 'analysis' ? [] : (Array.isArray(answer?.parties) ? answer.parties : [])
        .filter(party => typeof party?.name === 'string' && party.name.trim())
        .slice(0, MAX_PARTIES)
        .map(party => ({
            name: party.name.trim(),
            what: String(party.what ?? '').trim(),
            other: (Array.isArray(party.other) ? party.other : []).map(String).map(name => name.trim()).filter(Boolean).slice(0, 2),
        }));
    return {kind, parties};
};

const pickPrompt = (asked) => `For each name, the Wikidata item that is it, among the ones found. "none" when none is.
${asked.map((party, i) => `[${i + 1}] ${party.name} (${party.what}):
${party.found.map(item => `   ${item.qid}: ${item.label}${item.description ? ` - ${item.description}` : ''}`).join('\n')}`).join('\n')}
Answer in JSON only: {"items": [{"n": 1, "qid": "Q123"}]}`;

export const checkPrompt = (card, posts) => `A news card: "${card.title}"${card.titleTranslation ? ` (${card.titleTranslation})` : ''}
What it says: ${card.text}

Posts published by the parties concerned themselves, on their own official channels:
${posts.map((post, i) => `[${i + 1}] ${post.party}, ${post.at?.slice(0, 10) ?? 'no date'}: ${[post.title, post.text].filter(Boolean).join(' - ').slice(0, 400)}`).join('\n')}

For each post, in any language, what it is to the card:
"confirms": the post itself states the card's main fact (the same transfer, appointment, decision,
  figure, result), so the party made it official. Only the main fact, not a detail around it.
"denies": the post says the card's main fact is false, or states a different outcome of it.
"related": the same person, club or affair, but not the card's fact (another match, another signing,
  a reaction, a preview, a picture with no statement of it).
"other": anything else, or too vague to tell.
Answer in JSON only: {"posts": [{"n": 1, "kind": "related"}]}`;

const keyOf = (party) => `${party.name}|${party.what}`;
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const mediumOfUrl = (url) => {
    const host = hostOf(url);
    return host ? mediumOf(host) : null;
};

const politely = async (call) => {
    for (let attempt = 0; ; attempt++) {
        try {
            await pause(SEARCH_PAUSE_MS);
            return await call();
        } catch (err) {
            if (attempt >= SEARCH_WAITS_MS.length) throw err;
            await pause(SEARCH_WAITS_MS[attempt]);
        }
    }
};

// {name|what -> qid} of these parties: the ones searched already from the database, the others
// searched in Wikidata under each of their names, the item picked by the AI among the answers. A
// search under the name the card gives alone lost 75 of 357 parties ("CONI", "AZ", a name in
// Bulgarian); under their English and short names too, 24 of them were found, 4 cards more confirmed
export const itemsOf = async (parties, usage = null) => {
    const unique = [...new Map(parties.map(party => [keyOf(party), party])).values()];
    const known = await OfficialModel.names(unique);
    const asked = [];
    let searches = 0, refused = false;
    const until = Date.now() + SEARCH_MS;
    for (const party of unique.filter(party => !known.has(keyOf(party)))) {
        const names = [party.name, ...party.other];
        if (refused || searches + names.length > MAX_SEARCHES || Date.now() > until) break;
        searches += names.length;
        const found = [];
        for (const name of names) {
            await pause(SEARCH_PAUSE_MS);
            const list = await searchItems(name, 'en').catch(() => null);
            if (list === null) { refused = true; break; }
            found.push(...list);
        }
        // a party some of whose names were not searched is searched again next time
        if (!refused) asked.push({...party, found: [...new Map(found.map(item => [item.qid, item])).values()].slice(0, 8)});
    }

    // a name Wikidata found nothing for, or the AI picked none of, is searched again in 7 days; one
    // the AI failed on, next time
    const decided = asked.filter(party => party.found.length === 0).map(party => ({...party, qid: null}));
    const withFound = asked.filter(party => party.found.length > 0);
    for (let i = 0; i < withFound.length; i += PICKS_PER_CALL) {
        const chunk = withFound.slice(i, i + PICKS_PER_CALL);
        const answer = await ollamaJson(pickPrompt(chunk), usage).catch(() => null);
        if (!Array.isArray(answer?.items)) continue;
        const picks = new Map(answer.items.map(pick => [Number(pick?.n), pick?.qid]));
        chunk.forEach((party, j) => {
            const qid = picks.get(j + 1);
            decided.push({...party, qid: party.found.some(item => item.qid === qid) ? qid : null});
        });
    }
    await OfficialModel.saveNames(decided.map(({name, what, qid}) => ({name, what, qid})));
    for (const party of decided) known.set(keyOf(party), party.qid);
    return known;
};

// {qid -> {qid, label, channels, site_feed}}: the items with their channels, read from Wikidata when
// unknown or older than 30 days
const channelsOf = async (qids) => {
    const rows = new Map((await OfficialModel.items(qids)).map(row => [row.qid, row]));
    const stale = qids.filter(qid => !rows.get(qid)?.fresh);
    if (stale.length > 0) {
        const read = await politely(() => readChannels(stale)).catch(err => {
            console.error(`Official sources: the channels of ${stale.length} items were not read (${err.message})`);
            return [];
        });
        await OfficialModel.saveChannels(read);
        for (const item of read) rows.set(item.qid, {...rows.get(item.qid), ...item, fresh: true});
    }
    return rows;
};

// The feed of an item's website, found once (the bridge's when it publishes none) and kept: findFeeds
// reads its home page and tries its feeds, too slow to wait for. Unknown, it is looked for apart and
// '' answered: the next briefing reads it. '' too when the site has none
const lookingFor = new Set();
const findSiteFeed = async (item) => {
    let url = '';
    try {
        const feeds = await Promise.race([findFeeds(item.channels.site[0]),
            new Promise((resolve, reject) => setTimeout(() => reject(new Error('timeout')), FEED_TIMEOUT_MS))]);
        url = feeds[0]?.url ?? '';
    } catch {
        // no feed found: tried again in 7 days
    }
    await OfficialModel.saveSiteFeed(item.qid, url);
};
const siteFeedOf = (item) => {
    if (item.site_feed_fresh) return item.site_feed;
    if (!lookingFor.has(item.qid)) {
        lookingFor.add(item.qid);
        findSiteFeed(item)
            .catch(err => console.error(`Official sources: the feed of ${item.channels.site[0]} was not looked for (${err.message})`))
            .finally(() => lookingFor.delete(item.qid));
    }
    return '';
};

const plainText = (html) => String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
const toIso = (date) => {
    const time = date ? Date.parse(date) : NaN;
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

// [{channel, at, title, text, url}]: the posts of an item on its website (the news our feeds read of
// it, and its own feed read now), on Mastodon and on Bluesky
const postsOf = async (item, newsOfSite) => {
    const posts = [...newsOfSite];
    const feed = item.channels?.site?.[0] ? siteFeedOf(item) : '';
    if (feed) {
        const [read] = await Crawlers.Xml([{url: feed}]);
        posts.push(...(read.items ?? []).map(entry => ({channel: 'site', at: toIso(entry.pubDate),
            title: String(entry.title ?? '').trim(), text: plainText(entry.description), url: entry.link})));
    }
    const mastodon = item.channels?.mastodon?.[0]?.replace(/^@/, '').split('@');
    if (mastodon?.length === 2) {
        const [read] = await Crawlers.Xml([{url: `https://${mastodon[1]}/@${mastodon[0]}.rss`}]);
        posts.push(...(read.items ?? []).map(entry => ({channel: 'mastodon', at: toIso(entry.pubDate),
            title: '', text: plainText(entry.description), url: entry.link})));
    }
    const bluesky = item.channels?.bluesky?.[0];
    if (bluesky) {
        const answer = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?${new URLSearchParams({
            actor: bluesky, limit: '60', filter: 'posts_no_replies'})}`, {signal: AbortSignal.timeout(15e3)})
            .then(res => res.ok ? res.json() : {}).catch(() => ({}));
        posts.push(...(answer.feed ?? []).filter(entry => !entry.reason).map(entry => ({channel: 'bluesky',
            at: toIso(entry.post?.record?.createdAt), title: '', text: String(entry.post?.record?.text ?? '').slice(0, 300),
            url: `https://bsky.app/profile/${bluesky}/post/${String(entry.post?.uri ?? '').split('/').pop()}`})));
    }
    return posts.filter(post => post.url && (post.title || post.text));
};

const plain = (text) => String(text ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const wordsOf = (text) => new Set(plain(text).split(/[^a-z0-9]+/).filter(word => word.length >= 4));
const STOP_WORDS = new Set(['with', 'that', 'this', 'from', 'after', 'avec', 'pour', 'dans', 'contre', 'apres', 'their',
    'have', 'will', 'about', 'what', 'sans', 'plus', 'more', 'over', 'into', 'sont']);

// The posts of a card's parties worth judging: of the days around it, naming another of its parties or
// sharing words with its titles, the most alike first, MAX_CANDIDATES at most. parties: [{qid, label,
// name, site}], name the one shown (see partyName), posts: {qid -> [post]}
export const candidatesOf = (card, parties, posts) => {
    const from = Date.parse(card.first) - BEFORE_DAYS * 864e5;
    const cardWords = [...wordsOf([card.title, card.titleTranslation, ...(card.titles ?? [])].join(' '))].filter(word => !STOP_WORDS.has(word));
    const found = [];
    for (const party of parties) {
        for (const post of posts[party.qid] ?? []) {
            if (post.at && Date.parse(post.at) < from) continue;
            const words = wordsOf(`${post.title} ${post.text}`);
            const others = parties.filter(other => other !== party && [...wordsOf(other.label)].some(word => words.has(word))).length;
            const shared = cardWords.filter(word => words.has(word)).length;
            if (others + shared < 2) continue;
            found.push({...post, qid: party.qid, party: party.label, name: party.name ?? party.label, score: others * 2 + shared});
        }
    }
    return [...new Map(found.map(post => [post.url, post])).values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_CANDIDATES);
};

// The name a party's post is shown by. The AI names a party as the card's article does: "Eiropas Futbola
// federāciju asociācija" for UEFA below a Latvian card (12.10.2026). Its item gives the same name to
// every card: its acronym when its label is long (see shortName: UEFA, FIFA), else the AI's name when
// the label only says it longer ("Real Madrid" for "Real Madrid Club de Fútbol", "Chelsea"), else its
// English label ("Portuguese Football Federation" for "Federação Portuguesa de Futebol", "Arsène Wenger"
// for "Arsene Wenger"). Of the 174 names searched by 14.10.2026 (bench/official-party-names.mjs), the
// AI's kept 111 times, the 63 others all right. An item without an English label keeps the AI's name
export const partyName = (name, label, names = []) => {
    if (!label || /^Q\d+$/.test(label)) return name;
    const short = shortName(label, [name, ...names]);
    if (short !== label) return short;
    const [key, labelKey] = [mentionKey(name), mentionKey(label)];
    return key !== labelKey && ` ${labelKey} `.includes(` ${key} `) ? name : label;
};

// the posts both answers call "confirms", one per party, MAX_OFFICIAL at most. The second answer is
// of the posts in the reverse order
export const confirmedOf = (first, second, candidates) => {
    const kinds = (answer, order) => new Map((Array.isArray(answer?.posts) ? answer.posts : [])
        .map(item => [order[Number(item?.n) - 1], item?.kind]).filter(([post]) => post !== undefined));
    const reversed = [...candidates].reverse();
    const a = kinds(first, candidates), b = kinds(second, reversed);
    const parties = new Set();
    return candidates
        .filter(post => a.get(post) === 'confirms' && b.get(post) === 'confirms')
        .filter(post => !parties.has(post.qid) && parties.add(post.qid))
        .slice(0, MAX_OFFICIAL);
};

// The posts of a card's parties first, then the statements its articles report of the parties with no
// post (see statements.js), MAX_OFFICIAL at most
export const withStatements = (posts, statements) => {
    const said = new Set(posts.map(post => post.party.toLowerCase()));
    return [...posts, ...statements.filter(statement => !said.has(statement.party.toLowerCase()))].slice(0, MAX_OFFICIAL);
};

// The posts of a party's site read through Google News get the address of the site, saved for the next
// briefings: "said it" on a link of news.google.com did not show it came from uefa.com. Of the 18
// briefings of 12-14.10.2026, 8 of the 9 posts shown were such links (2 distinct ones), both decoded in
// 2 s. A link not decoded stays (it still leads to the post). Changes the items, never throws
export const withSiteLinks = async (items, decode = decodeLinks, save = FeedModel.saveResolvedLinks) => {
    const links = [...new Set(items.filter(item => item.channel !== 'reported' && isGoogleNewsUrl(item.url)).map(item => item.url))];
    if (links.length === 0) return;
    const decoded = await decode(links).catch(() => new Map());
    items.filter(item => decoded.has(item.url)).forEach(item => { item.url = decoded.get(item.url); });
    await save([...decoded].map(([link, resolved]) => ({link, resolved}))).catch(err =>
        console.error(`Official sources: the addresses of Google News were not saved (${err.message})`));
};

// cards: [{id, title, titleTranslation, titles, text, first, texts}], first the date of its first news,
// texts its articles read [{source, url, publishedAt, page}]. language: the reader's, a statement quoted
// in another one translated. Answers a Map id -> [{party, title, url, channel, publishedAt}], the posts
// where a party said the card's fact itself, and the statements its articles report: channel
// 'reported', title the sentence quoted, translation, source the medium reporting it, url its article;
// a card the AI failed on has none
export const officialSourcesOf = async (cards, usage = null, {language = 'en'} = {}) => {
    // the seconds of each part, logged: a slow briefing says where its time went
    const seconds = {};
    let started = Date.now();
    const done = (part) => {
        seconds[part] = Math.round((Date.now() - started) / 100) / 10;
        started = Date.now();
    };
    const asked = await mapWithConcurrency(cards, AI_CONCURRENCY, async (card) =>
        normalizeParties(await ollamaJson(partiesPrompt(card), usage)));
    const partiesOf = cards.map((card, i) => asked[i].status === 'fulfilled' ? asked[i].value.parties : []);
    done('parties');
    // the statements need the parties only: read while Wikidata and the channels are asked
    const reading = mapWithConcurrency(cards, AI_CONCURRENCY, (card, i) =>
        statementsOf(card, card.texts ?? [], partiesOf[i].map(party => party.name), usage));
    const qidOf = await itemsOf(partiesOf.flat(), usage);
    done('names');

    const qids = [...new Set(partiesOf.flat().map(party => qidOf.get(keyOf(party))).filter(Boolean))];
    const items = await channelsOf(qids);
    done('channels');
    const readable = [...items.values()].filter(item => READABLE.some(name => item.channels?.[name]?.length));
    const since = new Date(Math.min(...cards.map(card => Date.parse(card.first))) - BEFORE_DAYS * 864e5);
    const siteMedia = new Map(readable.map(item => [item.qid, mediumOfUrl(item.channels?.site?.[0] ?? '')]).filter(([, medium]) => medium));
    const news = await OfficialModel.newsOfMedia([...new Set(siteMedia.values())], since).catch(err => {
        console.error(`Official sources: the news of the official sites were not read (${err.message})`);
        return [];
    });
    const read = await mapWithConcurrency(readable, CHANNEL_CONCURRENCY, item => postsOf(item, news
        .filter(row => row.medium === siteMedia.get(item.qid))
        .map(row => ({channel: 'site', at: row.at?.toISOString?.() ?? null, title: row.title, text: plainText(row.description), url: row.url}))));
    const posts = Object.fromEntries(readable.map((item, i) => [item.qid, read[i].status === 'fulfilled' ? read[i].value : []]));
    done('posts');
    const statements = await reading;
    done('statements');

    const judged = await mapWithConcurrency(cards, AI_CONCURRENCY, async (card, i) => {
        // the first name the AI gave an item, when it gave it two ("UEFA", "Union of European..."), shown
        // as partyName says
        const parties = [...new Map(partiesOf[i].map(party => [party, items.get(qidOf.get(keyOf(party)))]).filter(([, item]) => item)
            .reverse().map(([party, item]) => [item.qid, {qid: item.qid, label: item.label, site: item.channels?.site ?? [],
                name: partyName(party.name, item.label, [...(party.other ?? []), ...(item.names ?? [])])}])).values()];
        const candidates = candidatesOf(card, parties, posts);
        if (candidates.length === 0) return [];
        const first = await ollamaJson(checkPrompt(card, candidates), usage);
        const second = await ollamaJson(checkPrompt(card, [...candidates].reverse()), usage);
        return confirmedOf(first, second, candidates).map(post => ({
            party: post.name,
            title: post.title || post.text,
            url: post.url,
            channel: post.channel,
            publishedAt: post.at,
        }));
    });
    done('check');
    const failed = judged.filter(result => result.status !== 'fulfilled').length + statements.filter(result => result.status !== 'fulfilled').length;
    if (failed > 0) console.error(`Official sources: ${failed} cards were not judged`);

    const shown = cards.map((card, i) => withStatements(judged[i].status === 'fulfilled' ? judged[i].value : [],
        (statements[i].status === 'fulfilled' ? statements[i].value : []).map(statement => ({
            party: statement.by,
            title: statement.sentence,
            translation: null,
            language: statement.language,
            url: statement.url,
            source: statement.source,
            channel: 'reported',
            publishedAt: statement.publishedAt,
        }))));
    // the statements quoted in another language than the reader's translated, as the denials are
    const foreign = shown.flat().filter(item => item.channel === 'reported' && item.language && item.language !== language
        && writtenIn(item.language) && writtenIn(language));
    const [translations] = await Promise.all([
        foreign.length === 0 ? [] : translateTexts(foreign.map(item => ({text: item.title, from: writtenIn(item.language)})),
            writtenIn(language), usage).catch(() => []),
        withSiteLinks(shown.flat()),
    ]);
    foreign.forEach((item, i) => { item.translation = translations[i] ?? null; });
    done('links');
    console.log(`Official sources: ${cards.length} cards, ${qids.length} items, ${readable.length} read, `
        + `${shown.flat().filter(item => item.channel === 'reported').length} statements, seconds ${JSON.stringify(seconds)}`);
    return new Map(cards.map((card, i) => [card.id, shown[i]]));
};
