//
//  Author: Fabian Rostello
//  Date: 07.10.2026
//  File: test.bridge-address.js
//  Description: The address of the RSS-Bridge of the server never reaches a client: the sources of the
//               profile, the ones left out by the thumbs and the feeds of the reader are sent with a key
//               and no url when they are read through it, and the key keeps a source left out
//

import process from 'node:process'
import {jest} from '@jest/globals';

const BRIDGE = 'http://bridge.invalid:3000';
const PAGE = `${BRIDGE}/?action=display&bridge=CssSelectorBridge&home_page=https%3A%2F%2Flematin.ch`;
const FEED = 'https://rts.ch/rss';

const ProfileModel = {
    get: jest.fn(async () => null),
    interests: jest.fn(async () => []),
    profileFeedRelevance: jest.fn(async () => []),
    removedSources: jest.fn(async () => []),
    ownFeedUrls: jest.fn(async () => []),
    keptSources: jest.fn(async () => []),
    keepSource: jest.fn(async () => {}),
};
const FeedModel = {
    listUserFeeds: jest.fn(async () => [
        {id: 1, url: PAGE, site: 'lematin.ch', category: 'world', origin: 'profile'},
        {id: 2, url: FEED, site: 'rts.ch', category: 'world', origin: 'profile'},
        {id: 3, url: `${BRIDGE}/?action=display&home_page=https%3A%2F%2Fmine.ch`, site: 'mine.ch', category: 'world', origin: 'user'},
    ]),
    trustedFeedUrls: jest.fn(async () => []),
    countUserFeeds: jest.fn(async () => 3),
    userFeedUrls: jest.fn(async () => []),
    addUserFeed: jest.fn(async (feed) => ({id: 9, origin: 'user', ...feed})),
};
// three cards refused of each feed found for the profile: both are left out
const BriefingModel = {
    votes: jest.fn(async () => ['A', 'B', 'C'].map(title => ({title, vote: 'down', feedUrls: [PAGE, FEED]}))),
};

jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
jest.unstable_mockModule('../../models/profile-model.js', () => ({ProfileModel}));
jest.unstable_mockModule('../../models/feed-model.js', () => ({FeedModel}));
jest.unstable_mockModule('../../models/briefing-model.js', () => ({BriefingModel}));
jest.unstable_mockModule('../../services/feed-service.js', () => ({FeedService: {languages: () => ['en', 'fr'], categories: () => ['world']}}));
jest.unstable_mockModule('../../services/discovery-service.js', () => ({
    DiscoveryService: {phaseOf: () => null, start: jest.fn()}, JUDGE_THRESHOLD: 0.5, RELEVANCE_DAYS: 14,
}));
const IngestService = {run: jest.fn(async () => {})};
jest.unstable_mockModule('../../services/ingest-service.js', () => ({IngestService, searchesOfUser: async () => []}));
jest.unstable_mockModule('../../services/source-service.js', () => ({SourceService: {}}));
jest.unstable_mockModule('../../services/recommendation-service.js', () => ({RecommendationService: {}}));
const findFeeds = jest.fn();
jest.unstable_mockModule('../../services/utils/feed-finder.js', () => ({findFeeds}));
const Crawlers = {Xml: jest.fn(async (feeds) => feeds.map(({url}) => ({url, items: [{title: 'Un titre'}]})))};
jest.unstable_mockModule('../../services/utils/crawlers.js', () => ({Crawlers}));
jest.unstable_mockModule('../../services/utils/embedder.js', () => ({embed: jest.fn(), toSparsevec: jest.fn(), toVector: jest.fn()}));
jest.unstable_mockModule('../../services/utils/profile-ai.js', () => ({interestsOf: jest.fn()}));

const {ProfileService} = await import('../../services/profile-service.js');
const {FeedController} = await import('../../controllers/feed-controller.js');
const {sourceKey} = await import('../../services/utils/public-url.js');

let bridge;
beforeAll(() => {
    bridge = process.env.RSS_BRIDGE_URL;
    process.env.RSS_BRIDGE_URL = BRIDGE;
});
afterAll(() => {
    if (bridge === undefined) delete process.env.RSS_BRIDGE_URL;
    else process.env.RSS_BRIDGE_URL = bridge;
});
beforeEach(() => ProfileModel.keepSource.mockClear());

describe('the address of the bridge sent to a client', () => {
    it('should send the sources of the profile and the ones left out with a key, and no address on the bridge', async () => {
        const answer = await ProfileService.get(1);

        expect(JSON.stringify(answer)).not.toContain('bridge.invalid');
        expect(answer.sources.map(({id, key, url}) => ({id, key, url}))).toEqual([
            {id: 1, key: sourceKey(PAGE), url: null},
            {id: 2, key: sourceKey(FEED), url: FEED},
        ]);
        // the same key as the source it is, so the client matches them
        expect(answer.refusedSources.map(({key, url, site}) => ({key, url, site})).sort((a, b) => a.site.localeCompare(b.site))).toEqual([
            {key: sourceKey(PAGE), url: null, site: 'lematin.ch'},
            {key: sourceKey(FEED), url: FEED, site: 'rts.ch'},
        ]);
    });

    it('should send the feeds of the reader with a key, and no address on the bridge', async () => {
        const res = {status: jest.fn(() => res), json: jest.fn()};
        await FeedController.getUserFeeds({user: {id: 1}}, res);

        const {feeds} = res.json.mock.calls[0][0];
        expect(JSON.stringify(feeds)).not.toContain('bridge.invalid');
        expect(feeds.map(({id, url}) => ({id, url}))).toEqual([{id: 1, url: null}, {id: 2, url: FEED}, {id: 3, url: null}]);
        expect(new Set(feeds.map(feed => feed.key)).size).toBe(3);
    });

    it('should keep a source left out by its key, read through the bridge or not', async () => {
        await ProfileService.keepSource(1, sourceKey(PAGE));
        expect(ProfileModel.keepSource).toHaveBeenCalledWith(1, PAGE);

        await ProfileService.keepSource(1, sourceKey(FEED));
        expect(ProfileModel.keepSource).toHaveBeenLastCalledWith(1, FEED);
    });

    it('should add a site offered without its address from the feed this server finds again, and send it back without it', async () => {
        findFeeds.mockResolvedValue([{url: PAGE, language: 'fr'}]);
        const res = {status: jest.fn(() => res), json: jest.fn()};
        await FeedController.importSources({user: {id: 1}, body: {
            language: 'fr', subject: ['suisse'],
            sources: [{site: 'lematin.ch', feed: null, category: 'world'}, {site: 'rts.ch', feed: FEED, category: 'world'}],
        }}, res);

        expect(findFeeds).toHaveBeenCalledWith('lematin.ch', {language: 'fr', subject: ['suisse']});
        // the feed of rts.ch is read to check it, never an address on the bridge
        expect(Crawlers.Xml).toHaveBeenCalledWith([{url: FEED}]);
        expect(FeedModel.addUserFeed.mock.calls.map(([feed]) => feed.url)).toEqual([PAGE, FEED]);
        expect(IngestService.run).toHaveBeenCalledWith({urls: [PAGE, FEED]});
        const answer = res.json.mock.calls[0][0];
        expect(answer.errors).toEqual([]);
        expect(answer.feeds.map(feed => feed.url)).toEqual([null, FEED]);
        expect(JSON.stringify(answer)).not.toContain('bridge.invalid');
    });

    it('should keep nothing for a key of no source left out, nor for an address', async () => {
        await expect(ProfileService.keepSource(1, 'not-a-key')).rejects.toMatchObject({status: 404});
        await expect(ProfileService.keepSource(1, FEED)).rejects.toMatchObject({status: 404});
        await expect(ProfileService.keepSource(1, undefined)).rejects.toMatchObject({status: 400});
        expect(ProfileModel.keepSource).not.toHaveBeenCalled();
    });
});
