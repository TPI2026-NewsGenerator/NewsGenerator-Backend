//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: feed-controller.js
//  Description: Controller for the feeds added by a user (private to them)
//

"use strict"

import {FeedModel} from '../models/feed-model.js';
import {FeedService} from '../services/feed-service.js';
import {SourceService} from '../services/source-service.js';
import {RecommendationService} from '../services/recommendation-service.js';
import {findFeeds} from '../services/utils/feed-finder.js';
import {assertPublicUrl, forClient, hostOf, isBridgeUrl} from '../services/utils/public-url.js';
import {IngestService} from '../services/ingest-service.js';
import {bridgeRoom, isFlood, looksPrivate, MAX_USER_FEEDS} from '../services/utils/feed-limits.js';
import {Crawlers} from '../services/utils/crawlers.js';
import {feedLanguage} from '../services/utils/language.js';

const MAX_CHECKED_SITES = 25;       // per request: the client sends a long list a part at a time

const TOO_MANY = `You can't have more than ${MAX_USER_FEEDS} sources.`;

// a source to add read from its web page: offered with no address (see forClient), or one on our
// bridge a client sent all the same, never trusted
const fromPage = (feed) => feed === null || feed === undefined || isBridgeUrl(feed);
const NO_BRIDGE_ROOM = "You have as many sites without a feed as the server can read for you: this one publishes none.";

// the sources just added are read and embedded now, in background: else they waited the next run of
// the ingestion, up to 20 minutes, where the ones found for a profile are read at once
const readNow = (urls) => {
    if (urls.length === 0) return;
    IngestService.run({urls}).catch(err => console.error(`Ingest of the added sources failed: ${err.stack ?? err}`));
};

// a feed read through our RSS-Bridge has no url for the client, only its key (see forClient)
const toFeed = (feed) => ({
    id: feed.id,
    ...forClient(feed.url),
    site: feed.site,
    category: feed.category,
    origin: feed.origin,                        // 'user' added by hand, 'profile' found for the profile
    trusted: feed.trusted ?? false,             // a source the user trusts, its stories come first
    shared: feed.shared ?? false,               // a source the user shares: it can be suggested to others
    createdAt: feed.created_at,
    error: feed.last_error ?? null,             // why the last refresh of this feed failed
    lastFetchedAt: feed.last_fetched_at ?? null,
    newsPerDay: feed.news_per_day ?? 0,         // news it saved in the last 24 hours
    flood: isFlood(feed.news_per_day),          // over FLOOD_NEWS_PER_DAY: its news get their vectors last
});

export const FeedController = {
    getUserFeeds: async (req, res) => {
        const feeds = await FeedModel.listUserFeeds(req.profileId);
        res.status(200).json({feeds: feeds.map(toFeed)});
    },

    // the user gives a site ("fortune.com") or a feed, the server finds the feed and checks it answers
    addUserFeed: async (req, res) => {
        const {site, category, language} = req.body;
        const spoken = FeedService.languages().includes(language) ? language : 'en';

        if (typeof site !== 'string' || site.trim() === '') {
            return res.status(400).json({error: "Please enter the address of a website."});
        }
        if (!FeedService.categories().includes(category)) {
            return res.status(400).json({error: `Category must be one of: ${FeedService.categories().join(', ')}.`});
        }
        if (await FeedModel.countUserFeeds(req.profileId) >= MAX_USER_FEEDS) {
            return res.status(400).json({error: TOO_MANY});
        }

        try {
            const feeds = await findFeeds(site, {language: spoken});
            if (feeds.length === 0) {
                return res.status(400).json({error: `No RSS feed found on "${site}".`});
            }

            // the feed with the most recent news
            const found = feeds[0];
            if (isBridgeUrl(found.url) && bridgeRoom(await FeedModel.userFeedUrls(req.profileId)) === 0) {
                return res.status(400).json({error: NO_BRIDGE_ROOM});
            }
            const feed = await FeedModel.addUserFeed({
                userId: req.user.id, profileId: req.profileId,
                url: found.url,
                // the address of a feed given as it is is named after its site: "rts.ch"
                site: site.includes('://') ? hostOf(site.trim()) ?? site.trim() : site.trim(),
                category: category,
                // the one its news are written in, else the one of the search it was added from
                language: found.language ?? (FeedService.languages().includes(language) ? language : null),
            });
            readNow([feed.url]);

            res.status(200).json({feed: toFeed(feed), sample: found.titles});
        } catch (error) {
            if (error.code === 'P2002') {   // unique (id_user, url)
                return res.status(400).json({error: "You already added this source."});
            }
            res.status(error.status || 500).json({error: error.message ?? String(error)});
        }
    },

    // media covering the search of the user and missing from their sources, with the feed to add
    suggestSources: async (req, res) => {
        const {keywords, timeframe, language} = req.body;

        if (!Array.isArray(keywords) || keywords.length === 0) {
            return res.status(400).json({error: "Keywords are required to look for missing sources."});
        }

        try {
            const suggestions = await SourceService.suggest({
                keywords: keywords,
                timeframe: timeframe ?? {},
                profileId: req.profileId,
                // the panel follows the language of the search it was opened from
                language: FeedService.languages().includes(language) ? language : 'en',
            });

            res.status(200).json(suggestions);
        } catch (error) {
            res.status(error.status || 500).json({error: error.message ?? String(error)});
        }
    },

    // feeds of the directory for a site or a feed name (from 'directory', about 1 s), or of the media
    // publishing on these words (from 'web', 20 to 45 s): the client asks both and shows them in one
    // list, the directory as soon as it answers
    searchSources: async (req, res) => {
        const {query, language, from = 'directory'} = req.body;

        if (typeof query !== 'string' || query.trim() === '') {
            return res.status(400).json({error: "Enter a subject or a website to search for."});
        }
        if (!['directory', 'web'].includes(from)) {
            return res.status(400).json({error: "Search the directory or the web."});
        }

        try {
            const search = from === 'web' ? SourceService.searchWeb : SourceService.searchDirectory;
            res.status(200).json({sources: await search({
                query: query.trim().slice(0, 200),
                profileId: req.profileId,
                language: FeedService.languages().includes(language) ? language : 'en',
            })});
        } catch (error) {
            res.status(error.status || 500).json({error: error.message ?? String(error)});
        }
    },

    // {sites, language}: addresses of a list the reader imports (a file of theirs, read by the client),
    // MAX_CHECKED_SITES at most: the feed found for each and what keeps it out (SourceService.checkSites).
    // They are added by POST /feeds/import, which reads them again
    checkSites: async (req, res) => {
        const {sites, language} = req.body ?? {};

        if (!Array.isArray(sites) || sites.length === 0 || !sites.every(site => typeof site === 'string' && site.trim())) {
            return res.status(400).json({error: "Send the addresses of the sites to check."});
        }
        if (sites.length > MAX_CHECKED_SITES) {
            return res.status(400).json({error: `At most ${MAX_CHECKED_SITES} sites at a time.`});
        }

        try {
            res.status(200).json({sites: await SourceService.checkSites({
                sites: [...new Set(sites.map(site => site.trim().slice(0, 500)))],
                profileId: req.profileId,
                language: FeedService.languages().includes(language) ? language : 'en',
            })});
        } catch (error) {
            res.status(error.status || 500).json({error: error.message ?? String(error)});
        }
    },

    // add several suggested sources at once, their feed is checked again here: what the client sends
    // back is never trusted, it could be any address, and a directory can name a feed that died
    importSources: async (req, res) => {
        const {sources, language, subject} = req.body;
        const spoken = FeedService.languages().includes(language) ? language : 'en';

        // the keywords the sources were suggested for: a site read through the bridge is built again
        // on its section about them, as it was suggested. They only choose among the sections the
        // site links, never an address
        const keywords = Array.isArray(subject) && subject.every(keyword => typeof keyword === 'string')
            ? subject.slice(0, 20).map(keyword => keyword.slice(0, 200))
            : null;

        if (!Array.isArray(sources) || sources.length === 0) {
            return res.status(400).json({error: "Please select at least one source."});
        }

        // one read of each feed, so a dead one is refused instead of being added and never working.
        // The sites read from their page are left out: their feed is found again below, by this server.
        const checked = new Map((await Crawlers.Xml(sources
            .filter(source => !fromPage(source?.feed))
            .map(source => ({url: source.feed}))))
            .map(result => [result.url, result]));

        const added = [];
        const errors = [];
        let count = await FeedModel.countUserFeeds(req.profileId);
        let bridge = bridgeRoom(await FeedModel.userFeedUrls(req.profileId));

        for (let {site, feed, category} of sources) {
            const name = String(site ?? '').trim();
            let language = null;

            if (count >= MAX_USER_FEEDS) {
                errors.push({site, error: TOO_MANY});
                continue;
            }
            if (!FeedService.categories().includes(category)) {
                errors.push({site, error: `Unknown category "${category}".`});
                continue;
            }

            // A site that publishes no feed is read through the bridge, and the suggestions offer it
            // like any other source, without its address: the bridge runs on this machine, its address
            // never reaches a client, and a crafted one could point it anywhere. So the feed is built
            // again here from the name of the site, as the suggestion found it. What is added is then
            // always something this server decided, and the suggestion stays usable.
            if (fromPage(feed)) {
                if (bridge <= 0) {
                    errors.push({site, error: NO_BRIDGE_ROOM});
                    continue;
                }
                const found = name ? await findFeeds(name, {language: spoken, subject: keywords}) : [];
                if (found.length === 0) {
                    errors.push({site, error: `No RSS feed found on "${site}".`});
                    continue;
                }
                feed = found[0].url;        // findFeeds has just read it, so it answers and has news
                language = found[0].language;
            } else {
                const read = checked.get(feed);
                if (read && (read.error || read.items.length === 0)) {
                    errors.push({site, error: read.error ? `This feed does not answer (${read.error}).` : "This feed has no news."});
                    continue;
                }
                // told by its own news: the language of the search it was found from is not always its
                language = read ? feedLanguage(read.items.map(item => `${item.title ?? ''} ${item.description ?? ''}`), read.url) : null;
            }

            try {
                // the bridge answers on a private address on purpose, so it is the one address that
                // is not asked to be public: it is ours, not one a user gave
                const onBridge = isBridgeUrl(feed);
                const url = onBridge ? feed : (await assertPublicUrl(feed)).href;
                added.push(await FeedModel.addUserFeed({
                    userId: req.user.id, profileId: req.profileId,
                    url: url,
                    // an address of a list is named after its site, as one added by hand: "derstandard.at"
                    site: name.includes('://') ? hostOf(name) ?? name : name || url,
                    category: category,
                    language: language,
                }));
                count++;
                if (onBridge) bridge--;
            } catch (error) {
                const message = error.code === 'P2002' ? "You already added this source." : error.message;
                errors.push({site, error: message ?? String(error)});
            }
        }

        // read from their own address, sent without it when it is on our bridge
        readNow(added.map(feed => feed.url));
        res.status(200).json({feeds: added.map(toFeed), errors});
    },

    // One or both of:
    //  - {trusted}: among the stories close to the profile, the ones this source tells come first in
    //    the briefing and its article leads the card. Any source, one found for the profile too: it is
    //    then never removed, by its relevance or by the thumbs
    //  - {shared}: only a source added by hand. It can be suggested to the other readers whose
    //    interests it publishes on. Refused for an address that may hold a key of the reader (a paid
    //    newsletter, a private podcast)
    updateUserFeed: async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) {
            return res.status(400).json({error: "An id is required."});
        }
        const {trusted, shared} = req.body ?? {};
        if ((trusted === undefined && shared === undefined)
            || ![trusted, shared].every(value => value === undefined || typeof value === 'boolean')) {
            return res.status(400).json({error: "trusted and/or shared: true or false."});
        }

        const feed = await FeedModel.getUserFeed(req.profileId, id);
        if (!feed) {
            return res.status(404).json({error: "This source does not exist."});
        }
        if (shared !== undefined && feed.origin !== 'user') {
            return res.status(400).json({error: "Only a source you added can be shared: the ones found for your profile are already suggested to the others."});
        }
        if (shared && looksPrivate(feed.url)) {
            return res.status(400).json({error: "The address of this feed looks like it holds a private key: it can't be shared."});
        }

        const changes = {...(trusted !== undefined ? {trusted} : {}), ...(shared !== undefined ? {shared} : {})};
        await FeedModel.updateUserFeed(req.profileId, id, changes);
        res.status(200).json({id, trusted: feed.trusted, shared: feed.shared, ...changes});
    },

    // the sources this reader could add: found for the profile of other readers, or shared by them,
    // and publishing on the interests of this one. [{id, site, url, category, language, news, relevant, samples}]
    getRecommended: async (req, res) => {
        try {
            res.status(200).json({sources: await RecommendationService.list(req.profileId)});
        } catch (error) {
            res.status(error.status || 500).json({error: error.message ?? String(error)});
        }
    },

    // {ids}: recommended sources to add, by the id GET /feeds/recommended gave them
    addRecommended: async (req, res) => {
        try {
            const {feeds, errors} = await RecommendationService.add(req.user.id, req.profileId, req.body?.ids);
            res.status(200).json({feeds: feeds.map(toFeed), errors});
        } catch (error) {
            res.status(error.status || 500).json({error: error.message ?? String(error)});
        }
    },

    deleteUserFeed: async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) {
            return res.status(400).json({error: "An id is required."});
        }

        const deleted = await FeedModel.deleteUserFeed(req.profileId, id);
        if (deleted === 0) {
            return res.status(404).json({error: "This source does not exist."});
        }

        res.status(200).json({deleted: true});
    },
}
