//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: test.recommendations.js
//  Description: The feeds of the other readers recommended on the interests of a reader once the AI
//               read the titles the vectors put on them, its answer kept a day
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const row = (id, url, relevant, news, titles) => ({id, url, category: 'sport', language: 'fr', news, relevant, samples: titles.slice(0, 2), titles});
const TENNIS = row(1, 'https://tennis.example/rss', 13, 318, ['Justice : la plainte des joueurs', 'Prize money : égalité des gains', 'Un procès']);
const REFEREES = row(2, 'https://arbitres.example/rss', 6, 50, ['La VAR critiquée', 'Un arbitre suspendu', 'Le salaire des arbitres', 'Un match']);

const recommendedFeeds = jest.fn();
const confirmOnSubject = jest.fn();
const interests = jest.fn(async () => [{text: "L'arbitrage du football"}]);
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
jest.unstable_mockModule('../../db/rss-links.js', () => ({rss: {}}));
jest.unstable_mockModule('../../models/feed-model.js', () => ({FeedModel: {recommendedFeeds, userFeedUrls: async () => []}}));
jest.unstable_mockModule('../../models/profile-model.js', () => ({ProfileModel: {get: async () => ({id: 7}), removedSources: async () => [], interests}}));
jest.unstable_mockModule('../../services/feedback-service.js', () => ({FeedbackService: {of: async () => ({refused: []})}, siteOf: url => new URL(url).hostname}));
jest.unstable_mockModule('../../services/discovery-service.js', () => ({JUDGE_THRESHOLD: 0.45, CONFIRMED_TITLES: 12}));
jest.unstable_mockModule('../../services/source-service.js', () => ({knownMedia: async () => new Set()}));
jest.unstable_mockModule('../../services/utils/profile-ai.js', () => ({confirmOnSubject}));
const {RecommendationService, afterConfirmation} = await import('../../services/recommendation-service.js');

let profileId = 100;
beforeEach(() => {
    profileId++;        // the answers of the AI are kept per profile
    recommendedFeeds.mockReset().mockResolvedValue([TENNIS, REFEREES]);
    confirmOnSubject.mockReset().mockImplementation(async (_, titles) =>
        new Set(titles.flatMap((title, index) => /VAR|arbitre/.test(title) ? [index] : [])));
});

describe('RecommendationService.list', () => {
    it('should recommend only the feeds whose titles the AI confirms on the interests, with the titles it confirmed', async () => {
        const sources = await RecommendationService.list(profileId);

        expect(confirmOnSubject).toHaveBeenCalledWith(["L'arbitrage du football"], TENNIS.titles);
        expect(sources.map(source => source.site)).toEqual(['arbitres.example']);
        // 3 titles of 4 confirmed: 6 news on the interests become 5
        expect(sources[0]).toMatchObject({relevant: 5, news: 50, samples: ['La VAR critiquée', 'Un arbitre suspendu']});
        expect(sources[0]).not.toHaveProperty('titles');
    });

    it('should ask the AI once a day per feed, again when the interests changed', async () => {
        await RecommendationService.list(profileId);
        await RecommendationService.list(profileId);
        expect(confirmOnSubject).toHaveBeenCalledTimes(2);

        interests.mockResolvedValueOnce([{text: 'Le tennis'}]);
        await RecommendationService.list(profileId);
        expect(confirmOnSubject).toHaveBeenCalledTimes(4);
    });

    it('should judge a feed on the vectors alone when the AI does not answer, and ask it again next time', async () => {
        confirmOnSubject.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('down'));
        expect((await RecommendationService.list(profileId)).map(source => source.site)).toEqual(['tennis.example', 'arbitres.example']);

        expect((await RecommendationService.list(profileId)).map(source => source.site)).toEqual(['arbitres.example']);
        expect(confirmOnSubject).toHaveBeenCalledTimes(4);
    });

    it('should stop asking the AI once there are enough feeds to recommend', async () => {
        recommendedFeeds.mockResolvedValue(Array.from({length: 30}, (_, i) => ({...REFEREES, id: i + 1, url: `https://arbitres${i}.example/rss`})));
        expect(await RecommendationService.list(profileId)).toHaveLength(20);
        expect(confirmOnSubject).toHaveBeenCalledTimes(20);
    });
});

describe('afterConfirmation', () => {
    it('should keep a feed on the share of its titles confirmed, if it is still 3 news and 2% of its news', () => {
        expect(afterConfirmation(REFEREES, {titles: ['a', 'b', 'c'], judged: 6})).toMatchObject({relevant: 3});
        expect(afterConfirmation(REFEREES, {titles: ['a', 'b', 'c'], judged: 8})).toBeNull();
        expect(afterConfirmation({...REFEREES, relevant: 12, news: 300}, {titles: ['a', 'b', 'c'], judged: 6})).toMatchObject({relevant: 6, samples: ['a', 'b']});
        expect(afterConfirmation({...REFEREES, relevant: 12, news: 400}, {titles: ['a', 'b', 'c', 'd'], judged: 12})).toBeNull();
        expect(afterConfirmation({...REFEREES, titles: []}, {titles: [], judged: 0})).toBeNull();
        expect(afterConfirmation(REFEREES, null)).toBe(REFEREES);
    });
});
