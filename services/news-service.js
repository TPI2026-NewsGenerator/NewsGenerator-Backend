//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: news-service.js
//  Description: Service for news feature
//

"use strict"

import process from "node:process";
import Links from "./utils/links.js";
import {Crawlers} from "./utils/crawlers.js";
import {Filter} from "./utils/filter.js";
import {FeedModel} from "../models/feed-model.js";
import {canSummarize, extractArticle, passagesText, translateTexts, translationFor} from "./utils/extract.js";
import {languageOf, writtenIn} from "./utils/language.js";
import {mapWithConcurrency} from "./utils/concurrency.js";
import {hedgedBy} from "./utils/hedging.js";
import {averageLink, unionFind} from "./utils/grouping.js";
import {corroborationOf} from "./utils/corroboration.js";
import {dateOf, mediumOfArticle, readingOrder, sourceOf} from "./utils/reading-order.js";
import {embed, toSparsevec, toVector} from "./utils/embedder.js";
import {sortByMeaning} from "./utils/search-ai.js";
import {mergeStories} from "./utils/profile-ai.js";
import {decodeLinks, googleAvailable, isGoogleNewsUrl, sentenceUrl} from "./utils/google-news.js";
import {GOOGLE_ENABLED, IngestService, searchesOfCategories, sentenceFeeds} from "./ingest-service.js";
import {DirectoryModel} from "../models/directory-model.js";

export const MAX_SELECTED_NEWS = 10;
export const MAX_STORY_ARTICLES = 30;  // articles of one card sent to be summarized, a group is never bigger
const AI_CONCURRENCY = 5;       // resumes asked to Ollama at the same time
// real addresses of news of Google News asked for the key passages: 2 per card, 10 cards at most
const DECODED_PER_STORY = 2;
const MAX_DECODED = 10;
// Two titles telling the same news share less than one would think: the Guardian writing "Columbus
// Crew sack coach Federico Higuain for man's game jibe aimed at female referee" and the Independent
// writing "Gonzalo Higuain's brother sacked by MLS club after telling female referee this is a man's
// game" only reach 0.325 — and 0.294 with the accent of "Higuaín" that the Guardian writes and the
// Independent does not, which is why the accents are removed before comparing (see
// FeedModel.similarArticlePairs). Measured on a day of sport news, every pair between 0.30 and 0.45
// was a real duplicate; under 0.30 the betting tips of two different matches start being grouped.
// 0.25 and not 0.30 because the grouping asks an article to resemble a whole group and not one of
// its members (see averageLink): that is a harder question, so it is asked with a lower bar. Both
// were measured on the same forty groups judged by hand; 0.30 only recovers 16 of them, 0.25
// recovers 39, and neither ever puts two media on a news they do not share.
const SIMILARITY = 0.25;        // above this, two titles tell the same news (trigram similarity)
const SAME_COPY = 0.85;         // above this they are the same text, a wire republished as it is

// A title shorter than this is mostly the template of its paper, so it keeps the stricter threshold:
// trigrams cannot tell "Health Care Roundup: Market Talk" from "Auto & Transport Roundup: Market
// Talk". Measured on a wide search, the guard drops 32 pairs of 182, and none at all on a search
// inside one category. It costs a few duplicates that stay apart, as they did before, which is the
// safer mistake: merging two different news hides one of them and inflates the count of media.
const SHORT_TITLE = 40;
const SHORT_TITLE_SIMILARITY = 0.45;
const MIN_RESULTS = 5;          // under this, a search asking for every word is asked again for any of them
// A sentence: the news the AI reads, the closest in meaning and the ones with the most of its words
// (a name the meaning of the news is far from). 80 + 30 are 4000 to 7000 tokens, answered in 1 to 3 s
const BY_MEANING = 80;
const BY_WORDS = 30;
// The news Google News gives for a sentence are read by the AI whatever their vectors say: with
// every feed, bge-m3 ranked "Claude Sonnet 5.5" 151st for "new AI models for programming", Copilot
// 691st and Gemini 4 1050th, and the AI never saw them (bench/why-rank.mjs). Google ranked them
// for the sentence already; its feed gives up to 100, the closest 40 are read
const BY_GOOGLE = 40;
const MEANING_SPARSE_WEIGHT = 0.5;  // as the briefing ranks the news of an interest (rank_stories)
const UNCHECKED_RESULTS = 30;       // the closest given when the AI does not answer

// A search reads every language and shows its cards in the one chosen: the titles and descriptions in
// another are translated as the reader reaches them (see translateNews), this many in one call to the
// AI. A text is translated once per language, whatever the search showing it: the last ones are kept
const TEXTS_PER_CALL = 20;
const MAX_KEPT_TRANSLATIONS = 20000;
const translated = new Map();       // language and text -> its translation, null when it could not be

// a feed built from a page (see feed-bridge.js) gives the whole article as its description, where a
// published feed gives a few lines. The card only shows the beginning, the whole text stays in the
// database for the search to read.
const CARD_LENGTH = 400;
const shorten = (text) => !text || text.length <= CARD_LENGTH
    ? text
    : text.slice(0, CARD_LENGTH).replace(/\s+\S*$/, '') + '…';

// the site an article is shown under: for a news of Google News the publisher Google names, not
// news.google.com (its link stays the one of Google, which leads the reader to the article)
const siteOf = (article) => sourceOf(article.source_url ?? article.link);

// the language of an article: told when it got its vectors, else read from its title and description
const languageOfArticle = (article) => article.lang ?? languageOf(`${article.title} ${article.description ?? ''}`);

// cached article -> format sent to the client
const toNews = (article) => ({
    url: article.link,
    thumbnail: article.thumbnail,
    source: siteOf(article),
    publishedAt: article.published_at?.toISOString() ?? '',
    title: article.title,
    description: shorten(article.description),
    // the language it is written in, its title shown translated in the one searched (see translateNews)
    language: languageOfArticle(article),
    topic: article.topic,
    // who the article credits for what it reports, answered by the AI with the summary
    sourcing: article.sourcing,
    // the words the article itself used to say it has no confirmation, null when it has none
    hedged: hedgedBy(article.title, article.description),
});

// group the articles telling the same news: the first one is kept and the others become its
// 'sources', so the user doesn't see the same news ten times.
//
// A news in a story of the background work (id_story, bge-m3, see assign_stories) is grouped with
// its story, as in the briefing. The news without one (not embedded within 48 hours of their
// publication) are grouped among themselves by the trigrams of their titles. Measured on eleven
// searches of a week, every card where the two ways disagree read by hand: the stories were right
// 74 times, the trigrams 31 (bench/story-cards.mjs). Grouping the results again with the rules of
// the stories did no better than the stories, and made big cards of a whole subject.
//
// The same titles are grouped twice, at two thresholds, and the second one is what says something.
// A wire of Reuters or the AFP republished by twenty sites gives twenty media but one wording: that
// is one report seen twenty times, not twenty confirmations. Twenty media that each wrote their own
// headline about the same event did each go and check. So both numbers are answered, and neither is
// called reliable: a rumour repeated by twenty sites is still a rumour.
const groupDuplicates = async (articles) => {
    const pairs = await FeedModel.similarArticlePairs(articles.map(article => article.id), SIMILARITY,
        {shortTitle: SHORT_TITLE, shortThreshold: SHORT_TITLE_SIMILARITY});

    const alone = articles.filter(article => article.id_story == null);
    const aloneIds = new Set(alone.map(article => article.id));
    const byTitle = averageLink(alone, pairs.filter(pair => aloneIds.has(pair.id_a) && aloneIds.has(pair.id_b)), SIMILARITY);
    const storyOf = new Map(articles.map(article => [article.id, article.id_story]));
    const sameNews = (id) => storyOf.get(id) != null ? `story ${storyOf.get(id)}` : `title ${byTitle(id)}`;
    // the same text republished is transitive: if A is B word for word and B is C, then A is C.
    // So the wire count keeps the single link, where it is right rather than dangerous.
    const sameCopy = unionFind(articles, pairs.filter(pair => pair.score >= SAME_COPY));

    const news = new Map();     // group -> news sent to the client
    for (let article of articles) {
        const group = sameNews(article.id);

        if (!news.has(group)) {
            news.set(group, {...toNews(article), story: article.id_story ?? null, thread: article.id_thread ?? null,
                             sources: [], media: new Set(), wordings: new Set()});
        } else {
            const {url, source, title, publishedAt} = toNews(article);
            news.get(group).sources.push({url, source, title, publishedAt});
        }

        // a medium publishing the same news in two of its feeds is one medium, and two articles
        // written the same way are one wording
        news.get(group).media.add(mediumOfArticle(article));
        news.get(group).wordings.add(sameCopy(article.id));
    }

    // a medium publishing two differently worded articles about the same news would give more
    // wordings than media, which reads as nonsense. What the reader is told is how many of the
    // media wrote their own, so the count never goes above them.
    return [...news.values()].map(({media, wordings, ...item}) => ({
        ...item,
        corroboration: {media: media.size, wordings: Math.min(wordings.size, media.size)},
    }));
};

// A news is grouped with the others of its language only (see assign_stories): read in every language,
// a search showed the Negreira affair on nine cards, one per language. The cards of two languages are
// joined when the AI says they tell the same fact (the prompt of the briefing, see mergeStories), asked
// only of the cards with two articles in two languages this close in their texts: the vectors alone
// put the inflation of Belgium with the one of Germany (0.885) above most real pairs. Measured on 10
// searches (bench/cross-language-merge.mjs): 35 cards joined, 34 telling the same fact, the inflations
// left apart, 1 to 4 s more and no call when no pair is that close. A card is only joined to one it
// was asked with: the AI joined others of one language, or of two that were not close
const JOIN_SIMILARITY = 0.75;
const MAX_JOINED_CARDS = 30;        // the first cards of a pair asked, in their order

const linksOf = (card) => [card.url, ...card.sources.map(source => source.url)];

// articleOf: link -> the article of the cache
const joinLanguages = async (cards, articleOf) => {
    const members = cards.flatMap((card, i) => linksOf(card)
        .map(link => articleOf.get(link)?.id).filter(id => id != null).map(id => ({card: i, id})));
    const pairs = await FeedModel.crossLanguagePairs(members, JOIN_SIMILARITY);
    const asked = [...new Set(pairs.flatMap(pair => [pair.a, pair.b]))].sort((a, b) => a - b).slice(0, MAX_JOINED_CARDS);
    if (asked.length < 2) return cards;

    const close = new Set(pairs.map(pair => `${pair.a}:${pair.b}`));
    const merges = await mergeStories(asked.map(i => ({id: String(i), lead: {title: cards[i].title, description: (cards[i].description ?? '').slice(0, 160)}})))
        .catch(err => {
            console.log(`Search: the cards of two languages were not joined (${err.message})`);
            return new Map();
        });
    const joined = new Map();       // card -> the card above it telling the same fact
    for (const [id, into] of merges) {
        const [card, above] = [Number(id), Number(into)];
        if (close.has(`${above}:${card}`)) joined.set(card, above);
    }

    const result = cards.map(card => ({...card, sources: [...card.sources], corroboration: {...card.corroboration}}));
    for (const [i, into] of joined) {
        const [card, target] = [result[i], result[into]];
        target.sources.push({url: card.url, source: card.source, title: card.title, publishedAt: card.publishedAt}, ...card.sources);
        // a medium writing in two languages is one medium; two languages are two wordings
        const media = new Set(linksOf(target).map(link => articleOf.get(link)).filter(Boolean).map(mediumOfArticle));
        target.corroboration.media = Math.max(media.size, target.corroboration.media);
        target.corroboration.wordings = Math.min(target.corroboration.wordings + card.corroboration.wordings, target.corroboration.media);
        if (card.match === 'answer') target.match = 'answer';
    }
    return result.filter((_, i) => !joined.has(i));
};

// A thread links the facts of one affair followed over days: the preview of a match, its result, the
// reactions to it (see assign_threads, db/add_threads.sql). The facts found of one thread are one card,
// the first one found leading it, and the card shows the whole affair in its order: the facts the
// search did not find too, read from the feeds of this reader only (a feed added by hand stays private).
// The key passages are still asked for one fact.
// Measured on a replay of the ingestion over five days, 74 search cards judged one news by hand: 55 in
// one thread, 33 in one story (bench/story-threads-online.py)
const MAX_THREAD_FACTS = 12;    // facts not found shown on a card, the closest in time to the ones found

const timeOf = (item) => Date.parse(item.publishedAt) || 0;

const withThreads = async (cards, feedUrls) => {
    const threadIds = [...new Set(cards.map(card => card.thread).filter(id => id != null))];
    const foundStoryIds = [...new Set(cards.map(card => card.story).filter(id => id != null))];
    const others = await FeedModel.threadArticles({
        feedUrls, threadIds, foundStoryIds, maxStories: MAX_THREAD_FACTS, maxArticles: MAX_STORY_ARTICLES,
    });

    // the facts not found, one per story: its first report leads it, as a news breaks
    const byStory = new Map();
    for (const article of new Map(others.map(article => [article.link, article])).values()) {
        if (!byStory.has(article.id_story)) byStory.set(article.id_story, []);
        byStory.get(article.id_story).push(article);
    }
    const otherFacts = [...byStory.values()].map(articles => {
        const [lead, ...rest] = [...articles].sort((a, b) => dateOf(a) - dateOf(b));
        return {
            ...toNews(lead), story: lead.id_story, thread: lead.id_thread, found: false,
            sources: rest.map(article => ({url: article.link, source: siteOf(article), title: article.title,
                                           publishedAt: article.published_at?.toISOString() ?? ''})),
            // how many media tell it; the wordings are only counted for the news found
            corroboration: {media: new Set(articles.map(mediumOfArticle)).size},
        };
    });

    const byThread = new Map();
    const result = [];
    for (const card of cards) {
        if (card.thread == null) {
            result.push({...card, facts: [{...card, found: true}]});
            continue;
        }
        if (!byThread.has(card.thread)) {
            byThread.set(card.thread, {...card, facts: []});
            result.push(byThread.get(card.thread));
        }
        byThread.get(card.thread).facts.push({...card, found: true});
    }
    for (const fact of otherFacts) byThread.get(fact.thread)?.facts.push(fact);
    for (const card of byThread.values()) card.facts.sort((a, b) => timeOf(a) - timeOf(b));
    return result;
};

// Every sentence is asked to Google News too, while our feeds are searched. It then knows the sentence,
// never who searched it. Measured against Google News (bench/vs-google.mjs, 15 searches of 7 days):
// asked only when our feeds answered little, 40% of its first 30 news were in no feed of ours, all of
// them from the searches it was not asked (measles had 1 card to its ~15 stories before). Under this
// many answers the search waits for its news and searches again with them; above, it answers at once
// and its news join the database for the next searches (see sentenceFeeds)
const WEB_MIN_ANSWERS = 5;
// Google News is asked as far back as the search reads, a month at most (the news are kept 30 days)
const WEB_MAX_DAYS = 30;

// the feed of Google News for this sentence, read and embedded now: its address, null when Google
// can't be asked (turned off, for the searches with SEARCH_GOOGLE_NEWS=off, or paused after a block)
// or did not answer
const webSearch = async (query, timeframe, language) => {
    if (!GOOGLE_ENABLED() || process.env.SEARCH_GOOGLE_NEWS === 'off' || !googleAvailable('searches')) return null;
    const start = timeframe?.start ? new Date(timeframe.start) : null;
    const days = start && !Number.isNaN(start.getTime())
        ? Math.min(WEB_MAX_DAYS, Math.max(1, Math.round((Date.now() - start) / (24 * 3600e3))))
        : WEB_MAX_DAYS;
    const url = sentenceUrl(query, {days, language});
    if (!url) return null;
    try {
        await IngestService.readNow([url]);
        return url;
    } catch (err) {
        console.log(`Search: Google News not read for "${query}" (${err.message})`);
        return null;
    }
};

export const NewsService = {
    // news list for the selection, read from the RSS cache (no page scraped). A sentence is searched by
    // its meaning (one call to the AI, see searchByMeaning), keywords with operators as written, in SQL
    getNews: async ({keywords, category, timeframe, userId, language = 'en'}) => {
        try {
            // 1. get links from categories, with the feeds this user added (private to them) and those
            // of every reader that are not private: found for a profile, shared, and the searches of
            // Google News of the profiles. A reader's search of "cartes Pokémon" found 1 news in the
            // shared feeds and their own, 10 with the searches of the profile of another reader
            // (bench/pool-sources.mjs). The feeds of the directory too, found by the server itself (see
            // DirectoryService), and the feeds of Google News of the sentences already searched (see
            // sentenceFeeds). Of every language: the language chosen is the one the cards are shown in
            // (their titles translated, see translateNews). Read in the language searched only, a search
            // of a reader with sources in 34 languages found 4 news for "Schiedsrichter im Fußball" and 28
            // in the languages of their profile (bench/search-languages.mjs)
            const [own, others, searches, directory, sentences] = await Promise.all([
                userId ? FeedModel.userFeedUrls(userId, category) : [],
                FeedModel.publicFeedUrls(category),
                searchesOfCategories(category),
                DirectoryModel.feedUrls(category),
                sentenceFeeds(),
            ]);
            const newsLinks = [...new Set([...Links.getAllLanguagesLinks(category, language), ...own, ...others, ...searches, ...directory, ...sentences])];

            if (!Filter.hasOperators(keywords)) {
                const query = keywords.join(' ').trim();
                // Google News is asked the sentence at once, while our feeds are searched
                const asked = webSearch(query, timeframe, language).catch(() => null);
                const found = await NewsService.searchByMeaning({query, feedUrls: newsLinks, timeframe, language});
                // enough answers: its news are still read, for the next searches, nobody waits for them
                if (found.news.filter(card => card.match !== 'related').length >= WEB_MIN_ANSWERS) return found;

                // few answers: the subject is one no feed of ours follows, its news are searched with the others
                const web = await asked;
                return web ? {...await NewsService.searchByMeaning({query, feedUrls: [...newsLinks, web], timeframe, googleFeed: web, language}), web: true} : found;
            }

            // 2. search in SQL (the feeds are read in background, see IngestService: nobody waits for them): keywords, excluded keywords (-word) and publication date
            const search = (parsed) => FeedModel.searchArticles({
                feedUrls: newsLinks,
                keywords: parsed,
                timeframe: timeframe,
            });

            const parsed = Filter.parse(keywords);
            const articles = await search(parsed);

            // "referee football soccer" asks for the three words in the same news, and almost none
            // has all three. Written like that in a web search it would only rank, never remove.
            // So when a search finds close to nothing, the wider one is counted and offered, not
            // done: widening "red card" on its own would answer everything about red or about card.
            let wider = null;
            if (articles.length < MIN_RESULTS && Filter.canWiden(parsed)) {
                const loose = Filter.widen(parsed);
                const found = await search(loose);

                if (found.length > articles.length) {
                    wider = {
                        found: found.length,
                        terms: loose.groups.map(([term]) => term.text),
                    };
                }
            }

            if (articles.length === 0) return {totalResults: 0, news: [], wider, mode: 'words'};

            // 3. once per link (a news can be in several feeds), then group the news telling the same story
            const uniqueArticles = [...new Map(articles.map(article => [article.link, article])).values()];
            // 4. the news of one affair on one card, with the facts of the affair not found
            const news = await withThreads(await groupDuplicates(uniqueArticles), newsLinks);

            return {
                totalResults: news.length,
                news: news,
                wider: wider,
                mode: 'words',
            }
        } catch (err) {
            console.log(`Error fetching news for ${category}: ${err}`);
            throw err;
        }
    },

    // A search written as a sentence: the news closest to it in meaning (bge-m3, the vectors of the
    // ingestion) are read by the AI, which says which ones answer it and which are only close to it
    // (see search-ai.js). The cards come in its order, the answers first, each with 'match'. Without
    // the AI the closest ones are given, 'checked' false; without the embedder the sentence can't be
    // searched, the reader is told to use exact words.
    searchByMeaning: async ({query, feedUrls, timeframe = {}, googleFeed = null, language = null}) => {
        let vector;
        try {
            [vector] = await embed([query]);
        } catch (err) {
            console.log(`Search by meaning: ${err.message}`);
            throw Object.assign(new Error('The search by meaning is not available right now. Put your words between quotes to find them exactly.'), {status: 503});
        }

        const candidates = await FeedModel.closestArticles({
            feedUrls, timeframe,
            dense: toVector(vector.dense),
            sparse: toSparsevec(vector.sparse),
            sparseWeight: MEANING_SPARSE_WEIGHT,
            byMeaning: BY_MEANING,
            byWords: BY_WORDS,
            givenFeeds: googleFeed ? [googleFeed] : [],
            byGiven: googleFeed ? BY_GOOGLE : 0,
            language,
        });
        if (candidates.length === 0) return {totalResults: 0, news: [], wider: null, mode: 'meaning', checked: true};

        // the AI reads a news once, as its closest article: a story of the background work is one
        // card (see groupDuplicates), and a title in several feeds or republished word for word is one line
        const keyOf = (article) => article.id_story != null ? `story ${article.id_story}` : `title ${article.title}`;
        const byKey = new Map();
        for (const article of candidates) {
            if (!byKey.has(keyOf(article))) byKey.set(keyOf(article), article);
        }
        const read = [...byKey.values()];

        let sorted;
        let checked = true;
        try {
            sorted = await sortByMeaning(query, read.map(article => ({id: String(article.id), title: article.title, description: article.description})));
        } catch (err) {
            console.log(`Search by meaning: the AI did not sort the news (${err.message})`);
            checked = false;
            sorted = {answers: read.slice(0, UNCHECKED_RESULTS).map(article => String(article.id)), related: []};
        }

        // link -> its place in the answer of the AI, the answers first
        const place = new Map([...sorted.answers, ...sorted.related].map((id, i) => [id, i]));
        const placeOf = (article) => place.get(String(byKey.get(keyOf(article)).id));
        const kept = [...new Map(candidates
            .filter(article => placeOf(article) !== undefined)
            .sort((a, b) => placeOf(a) - placeOf(b))
            .map(article => [article.link, article])).values()];
        const placeOfLink = new Map(kept.map(article => [article.link, placeOf(article)]));

        // a card answers when one of its articles does, and comes at the place of its best one
        const best = (card) => Math.min(...[card.url, ...card.sources.map(source => source.url)].map(link => placeOfLink.get(link) ?? Infinity));
        const sortedCards = (await groupDuplicates(kept))
            .map(card => ({card, at: best(card)}))
            .sort((a, b) => a.at - b.at)
            .map(({card, at}) => ({...card, match: !checked ? null : at < sorted.answers.length ? 'answer' : 'related'}));
        // the cards of one fact in several languages joined, led by the first one
        const facts = await joinLanguages(sortedCards, new Map(kept.map(article => [article.link, article])));
        // the facts of one affair on one card, led by the one the AI put first
        const news = await withThreads(facts, feedUrls);

        return {totalResults: news.length, news, wider: null, mode: 'meaning', checked};
    },

    // The titles of these news, and the descriptions of the cards ('news'), translated into 'language'
    // (a code) when they are written in another: [{url, language, title, description}], the language
    // they were written in, only the news with a translation, a text that lost a figure untranslated.
    // Only news of the cache: the AI is no translator for any text
    translateNews: async ({news = [], titles = [], language}) => {
        const urls = [...new Set([...news, ...titles])];
        const articles = await NewsService.cachedArticles(urls);
        const to = writtenIn(language);
        const withDescription = new Set(news);
        const wanted = urls.flatMap(url => {
            const article = articles.get(url);
            const from = languageOfArticle(article);
            if (!to || !from || from === language || !writtenIn(from)) return [];
            const description = withDescription.has(url) ? shorten(article.description) : null;
            return [{url, from, field: 'title', text: article.title},
                    ...(description ? [{url, from, field: 'description', text: description}] : [])];
        });

        const keyOf = (text) => `${language}\n${text}`;
        const missing = [...new Map(wanted.filter(item => !translated.has(keyOf(item.text)))
            .map(item => [item.text, {text: item.text, from: writtenIn(item.from)}])).values()];
        const calls = [];
        for (let i = 0; i < missing.length; i += TEXTS_PER_CALL) calls.push(missing.slice(i, i + TEXTS_PER_CALL));
        await mapWithConcurrency(calls, AI_CONCURRENCY, async (texts) => {
            const translations = await translateTexts(texts, to);
            texts.forEach(({text}, i) => translated.set(keyOf(text), translations[i]));
        });
        for (const key of translated.keys()) {
            if (translated.size <= MAX_KEPT_TRANSLATIONS) break;
            translated.delete(key);
        }

        const byUrl = new Map();
        for (const {url, from, field, text} of wanted) {
            const translation = translated.get(keyOf(text));
            if (!translation) continue;
            if (!byUrl.has(url)) byUrl.set(url, {url, language: from, title: null, description: null});
            byUrl.get(url)[field] = translation;
        }
        return [...byUrl.values()];
    },

    // articles of the cache for these urls, refuses an url that is not in the cache so the API
    // can't be used to scrape or summarize any page
    cachedArticles: async (urls) => {
        const articles = new Map((await FeedModel.getArticlesByLinks(urls)).map(article => [article.link, article]));

        const unknownUrls = urls.filter(url => !articles.has(url));
        if (unknownUrls.length > 0) {
            const err = new Error(`Unknown news: ${unknownUrls.join(', ')}`);
            err.status = 400;
            throw err;
        }

        return articles;
    },

    // full content of the news selected by the user, scraped only now
    getNewsContent: async (urls) => {
        const articles = await NewsService.cachedArticles(urls);

        const scraped = await Crawlers.Html(urls.map(url => ({
            url: url,
            userData: { thumbnail: articles.get(url).thumbnail }
        })));
        const contents = new Map(scraped.map(page => [page.url, page]));

        // same order as asked, RSS description used when the page can't be read (paywall, 403...)
        return urls.map(url => {
            const news = toNews(articles.get(url));
            const page = contents.get(url);

            return {
                ...news,
                author: page?.author ?? '',
                lang: page?.lang ?? '',
                content: page?.content || news.description,
                fullContent: Boolean(page?.content),
            };
        });
    },

    // The key passages of each card chosen by the user, and who tells it, as in the briefing.
    // stories: [{urls}], the articles of each card, its lead first. Up to 5 of them are read, one per
    // medium and a source the reader trusts first: their texts say how many were written apart from
    // the others (no AI, see corroborationOf), and the AI picks the key sentences of the first one
    // readable, shown as published (see extract.js), with a translation when it is not in the
    // language searched. The passages of an article are kept, a news asked twice costs nothing.
    summarizeStories: async (stories, {userId = null, language = 'en'} = {}) => {
        const articles = await NewsService.cachedArticles([...new Set(stories.flatMap(story => story.urls))]);
        const trusted = new Set(userId ? await FeedModel.trustedFeedUrls(userId) : []);

        const members = stories.map(story => story.urls.map(url => articles.get(url)));
        const reads = members.map(list => readingOrder(list, trusted));

        // a news of Google News is read at its real address, asked to Google only for the cards with
        // no other article to read and never twice: Google answers 429 soon (see google-news.js)
        const fromGoogle = (article) => isGoogleNewsUrl(article.feeds?.url ?? '');
        const toDecode = [...new Set(reads
            .filter(list => list.every(article => fromGoogle(article) && !article.resolved_link))
            .flatMap(list => list.slice(0, DECODED_PER_STORY).map(article => article.link)))].slice(0, MAX_DECODED);
        if (toDecode.length > 0) {
            const decoded = await decodeLinks(toDecode);
            for (const article of articles.values()) {
                if (decoded.has(article.link)) article.resolved_link = decoded.get(article.link);
            }
            await FeedModel.saveResolvedLinks([...decoded].map(([link, resolved]) => ({link, resolved})));
        }
        // a link of Google News not decoded is not read: it only leads to a redirect
        const readable = (article) => !fromGoogle(article) || Boolean(article.resolved_link);
        const addressOf = (article) => article.resolved_link ?? article.link;
        const pages = await Crawlers.Html([...new Set(reads.flat().filter(readable).map(addressOf))].map(url => ({url})));
        const byAddress = new Map(pages.filter(page => page.content).map(page => [page.url, page]));
        const pageOf = new Map(reads.flat()
            .filter(article => readable(article) && byAddress.has(addressOf(article)))
            .map(article => [article.link, byAddress.get(addressOf(article))]));

        const results = await mapWithConcurrency(reads, AI_CONCURRENCY, async (read) => {
            // the first lines of a page (a teaser, a paywall) do not tell the news
            const from = read.find(article => canSummarize(pageOf.get(article.link)?.content));
            if (!from) return null;
            if (Array.isArray(from.extract) && from.extract.length > 0) {
                if (from.translation_language === language) {
                    return {from, passages: from.extract, translation: from.translation, topic: from.topic, sourcing: from.sourcing};
                }
                const {translation} = await translationFor(from.extract, language);
                await FeedModel.saveTranslation(from.link, translation, language);
                return {from, passages: from.extract, translation, topic: from.topic, sourcing: from.sourcing};
            }
            const {passages, translation, topic, sourcing} = await extractArticle(from.title, pageOf.get(from.link), {language});
            if (passages.length === 0) return null;
            await FeedModel.saveExtract(from.link, {extract: passages, summary: passagesText(passages), topic, sourcing});
            await FeedModel.saveTranslation(from.link, translation, language);
            return {from, passages, translation, topic, sourcing};
        });

        return members.map((list, i) => {
            const result = results[i];
            const done = result.status === 'fulfilled' ? result.value : null;
            if (result.status === 'rejected') console.log(`Key passages failed for ${list[0].link}: ${result.reason}`);
            const lead = done?.from ?? list[0];
            const news = toNews(lead);
            const corroboration = corroborationOf(list.map(article => ({
                medium: mediumOfArticle(article),
                text: pageOf.get(article.link)?.content ?? null,
                byline: pageOf.get(article.link)?.author ?? null,
            })));

            return {
                ...news,
                // the card chosen is known by the url of its lead, whatever article was summarized
                id: list[0].link,
                // the sentences of the article as published, a paragraph per passage
                summary: passagesText(done?.passages),
                // their machine translation, when the article is not in the language searched
                translation: passagesText(done?.translation),
                topic: done?.topic ?? news.topic,
                sourcing: done?.sourcing ?? news.sourcing,
                summaryError: done ? null : result.status === 'rejected'
                    ? "The AI could not choose the key passages of this news, please try again."
                    : !list.some(readable)
                        ? "This news is only known through Google News, which did not give its address this time: open it with “Read the article”."
                        : "No article of this news could be read in full (paywall, protected site or its first lines only).",
                corroboration: {...corroboration, mediaNames: [...new Set(list.map(mediumOfArticle))]},
                articles: [...list]
                    .sort((a, b) => Number(trusted.has(b.feeds?.url)) - Number(trusted.has(a.feeds?.url)) || dateOf(b) - dateOf(a))
                    .map(article => ({
                        url: article.link,
                        source: siteOf(article),
                        title: article.title,
                        publishedAt: article.published_at?.toISOString() ?? '',
                        trusted: trusted.has(article.feeds?.url),
                    })),
            };
        });
    },
}
