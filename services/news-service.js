//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: news-service.js
//  Description: Service for news feature
//

"use strict"

import Links from "./utils/links.js";
import {Crawlers} from "./utils/crawlers.js";
import {Filter} from "./utils/filter.js";
import {FeedModel} from "../models/feed-model.js";
import {canSummarize, extractArticle, passagesText, translationFor} from "./utils/extract.js";
import {mapWithConcurrency} from "./utils/concurrency.js";
import {mediumOf} from "./utils/public-url.js";
import {hedgedBy} from "./utils/hedging.js";
import {averageLink, unionFind} from "./utils/grouping.js";
import {corroborationOf} from "./utils/corroboration.js";
import {dateOf, mediumOfArticle, readingOrder, sourceOf} from "./utils/reading-order.js";
import {embed, toSparsevec, toVector} from "./utils/embedder.js";
import {sortByMeaning} from "./utils/search-ai.js";

export const MAX_SELECTED_NEWS = 10;
export const MAX_STORY_ARTICLES = 30;  // articles of one card sent to be summarized, a group is never bigger
const AI_CONCURRENCY = 5;       // resumes asked to Ollama at the same time
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
const MEANING_SPARSE_WEIGHT = 0.5;  // as the briefing ranks the news of an interest (rank_stories)
const UNCHECKED_RESULTS = 30;       // the closest given when the AI does not answer

// a feed built from a page (see feed-bridge.js) gives the whole article as its description, where a
// published feed gives a few lines. The card only shows the beginning, the whole text stays in the
// database for the search to read.
const CARD_LENGTH = 400;
const shorten = (text) => !text || text.length <= CARD_LENGTH
    ? text
    : text.slice(0, CARD_LENGTH).replace(/\s+\S*$/, '') + '…';

// cached article -> format sent to the client
const toNews = (article) => ({
    url: article.link,
    thumbnail: article.thumbnail,
    source: sourceOf(article.link),
    publishedAt: article.published_at?.toISOString() ?? '',
    title: article.title,
    description: shorten(article.description),
    topic: article.topic,
    // who the article credits for what it reports, answered by the AI with the summary
    sourcing: article.sourcing,
    // the words the article itself used to say it has no confirmation, null when it has none
    hedged: hedgedBy(article.title, article.description),
});

// group the articles telling the same news: the most recent one is kept and the others become its
// 'sources', so the user doesn't see the same news ten times.
//
// The same titles are grouped twice, at two thresholds, and the second one is what says something.
// A wire of Reuters or the AFP republished by twenty sites gives twenty media but one wording: that
// is one report seen twenty times, not twenty confirmations. Twenty media that each wrote their own
// headline about the same event did each go and check. So both numbers are answered, and neither is
// called reliable: a rumour repeated by twenty sites is still a rumour.
const groupDuplicates = async (articles) => {
    const pairs = await FeedModel.similarArticlePairs(articles.map(article => article.id), SIMILARITY,
        {shortTitle: SHORT_TITLE, shortThreshold: SHORT_TITLE_SIMILARITY});

    const sameNews = averageLink(articles, pairs, SIMILARITY);
    // the same text republished is transitive: if A is B word for word and B is C, then A is C.
    // So the wire count keeps the single link, where it is right rather than dangerous.
    const sameCopy = unionFind(articles, pairs.filter(pair => pair.score >= SAME_COPY));

    const news = new Map();     // group -> news sent to the client
    for (let article of articles) {
        const group = sameNews(article.id);

        if (!news.has(group)) {
            news.set(group, {...toNews(article), sources: [], media: new Set(), wordings: new Set()});
        } else {
            const {url, source, title, publishedAt} = toNews(article);
            news.get(group).sources.push({url, source, title, publishedAt});
        }

        // a medium publishing the same news in two of its feeds is one medium, and two articles
        // written the same way are one wording
        news.get(group).media.add(mediumOf(sourceOf(article.link)));
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

export const NewsService = {
    // news list for the selection, read from the RSS cache (no page scraped). A sentence is searched by
    // its meaning (one call to the AI, see searchByMeaning), keywords with operators as written, in SQL
    getNews: async ({keywords, category, timeframe, userId, language = 'en'}) => {
        try {
            // 1. get links from categories, with the feeds this user added (private to them)
            const newsLinks = [...new Set([
                ...Links.getCategoriesLinks(category, language),
                ...(userId ? await FeedModel.userFeedUrls(userId, category) : []),
            ])];

            if (!Filter.hasOperators(keywords)) {
                return await NewsService.searchByMeaning({query: keywords.join(' ').trim(), feedUrls: newsLinks, timeframe});
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
            const news = await groupDuplicates(uniqueArticles);

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
    searchByMeaning: async ({query, feedUrls, timeframe = {}}) => {
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
        });
        if (candidates.length === 0) return {totalResults: 0, news: [], wider: null, mode: 'meaning', checked: true};

        // the AI reads a title once: the same news in several feeds, or republished word for word
        const byTitle = new Map();
        for (const article of candidates) {
            if (!byTitle.has(article.title)) byTitle.set(article.title, article);
        }
        const read = [...byTitle.values()];

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
        const placeOf = (article) => place.get(String(byTitle.get(article.title).id));
        const kept = [...new Map(candidates
            .filter(article => placeOf(article) !== undefined)
            .sort((a, b) => placeOf(a) - placeOf(b))
            .map(article => [article.link, article])).values()];
        const placeOfLink = new Map(kept.map(article => [article.link, placeOf(article)]));

        // a card answers when one of its articles does, and comes at the place of its best one
        const best = (card) => Math.min(...[card.url, ...card.sources.map(source => source.url)].map(link => placeOfLink.get(link) ?? Infinity));
        const news = (await groupDuplicates(kept))
            .map(card => ({card, at: best(card)}))
            .sort((a, b) => a.at - b.at)
            .map(({card, at}) => ({...card, match: !checked ? null : at < sorted.answers.length ? 'answer' : 'related'}));

        return {totalResults: news.length, news, wider: null, mode: 'meaning', checked};
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
        const pages = await Crawlers.Html([...new Set(reads.flat().map(article => article.link))].map(url => ({url})));
        const pageOf = new Map(pages.filter(page => page.content).map(page => [page.url, page]));

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
                    : "No article of this news could be read in full (paywall, protected site or its first lines only).",
                corroboration: {...corroboration, mediaNames: [...new Set(list.map(mediumOfArticle))]},
                articles: [...list]
                    .sort((a, b) => Number(trusted.has(b.feeds?.url)) - Number(trusted.has(a.feeds?.url)) || dateOf(b) - dateOf(a))
                    .map(article => ({
                        url: article.link,
                        source: sourceOf(article.link),
                        title: article.title,
                        publishedAt: article.published_at?.toISOString() ?? '',
                        trusted: trusted.has(article.feeds?.url),
                    })),
            };
        });
    },
}
