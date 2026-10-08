//
//  Author: Fabian Rostello
//  Date: 06.10.2026
//  File: test.discovery-steps.js
//  Description: The discovery in two steps: the sources of Google News are added and read without
//               waiting on the press of Media Cloud, whose queue answers 2 searches a minute
//

import {setImmediate} from 'node:timers';
import {beforeEach, describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
jest.unstable_mockModule('../../models/profile-model.js', () => ({ProfileModel: {
    interestsForDiscovery: jest.fn(), get: jest.fn(async () => ({id_user: 1, languages: ['en']})), addProfileFeeds: jest.fn(async () => {}),
    setDiscovery: jest.fn(async () => {}), deleteProfileFeeds: jest.fn(async () => 0),
    profileFeedRelevance: jest.fn(async () => []), keptSources: jest.fn(async () => []), removedSources: jest.fn(async () => []), discovering: jest.fn(async () => []),
}}));
jest.unstable_mockModule('../../models/feed-model.js', () => ({FeedModel: {
    userFeedUrls: jest.fn(async () => []), countUserFeeds: jest.fn(async () => 0), trustedFeedUrls: jest.fn(async () => []),
}}));
jest.unstable_mockModule('../../services/source-service.js', () => ({knownMedia: jest.fn(async () => new Set())}));
jest.unstable_mockModule('../../services/ingest-service.js', () => ({
    IngestService: {run: jest.fn(async () => ({}))}, searchesOfUser: jest.fn(async () => []),
}));
jest.unstable_mockModule('../../services/feedback-service.js', () => ({FeedbackService: {of: jest.fn(async () => ({refused: []}))}}));
jest.unstable_mockModule('../../services/utils/google-news.js', () => ({search: jest.fn()}));
jest.unstable_mockModule('../../services/utils/media-cloud.js', () => ({
    mediaFor: jest.fn(), knownFeeds: jest.fn(async () => []), mediaCloudEnabled: jest.fn(() => true),
}));
jest.unstable_mockModule('../../services/utils/feed-finder.js', () => ({
    findFeeds: jest.fn(async (site) => [{url: `https://${site}/feed`, onSubject: 5, onSubjectTitles: []}]),
    isOnSubject: jest.fn(() => true), subjectScore: jest.fn(() => 1),
}));
jest.unstable_mockModule('../../services/utils/profile-ai.js', () => ({
    confirmOnSubject: jest.fn(async () => null), parseSearch: jest.fn(search => search),
}));
jest.unstable_mockModule('../../services/utils/meaning-judge.js', () => ({JUDGE_THRESHOLD: 0.45, judgeOf: jest.fn(() => () => [])}));

const {DiscoveryService} = await import('../../services/discovery-service.js');
const {ProfileModel} = await import('../../models/profile-model.js');
const {IngestService} = await import('../../services/ingest-service.js');
const {search} = await import('../../services/utils/google-news.js');
const {mediaFor, mediaCloudEnabled} = await import('../../services/utils/media-cloud.js');

// the discovery runs in background: its steps are waited for
const until = async (condition) => {
    for (let i = 0; i < 200 && !condition(); i++) await new Promise(resolve => setImmediate(resolve));
    expect(condition()).toBe(true);
};
const statuses = () => ProfileModel.setDiscovery.mock.calls.map(call => call[1]);
const saved = (call) => ProfileModel.addProfileFeeds.mock.calls[call][2].map(feed => feed.url);

let answerPress;
beforeEach(() => {
    jest.clearAllMocks();
    mediaCloudEnabled.mockReturnValue(true);
    ProfileModel.interestsForDiscovery.mockResolvedValue([
        {position: 1, text: 'Sailing races', keywords: 'sailing', sections: [], category: 'sport', dense: '[1]', searches: [{lang: 'en', q: 'sailing'}]},
    ]);
    search.mockResolvedValue({media: [{site: 'sailworld.example', name: 'Sail World', news: 12}]});
    mediaFor.mockReturnValue(new Promise(resolve => { answerPress = resolve; }));
});

describe('DiscoveryService.start', () => {
    it('should add and read the sources of Google News while the press is still looked for', async () => {
        await DiscoveryService.start(1);
        await until(() => IngestService.run.mock.calls.length === 1);

        expect(saved(0)).toEqual(['https://sailworld.example/feed']);
        expect(IngestService.run).toHaveBeenCalledWith({urls: ['https://sailworld.example/feed']});
        expect(DiscoveryService.phaseOf(1)).toBe('press');
        expect(statuses()).not.toContain('done');

        answerPress([{site: 'yachting-daily.example', name: 'Yachting Daily', news: 5, lang: 'en'}]);
        await until(() => statuses().includes('done'));
        expect(saved(1)).toEqual(['https://yachting-daily.example/feed']);
        expect(IngestService.run).toHaveBeenLastCalledWith({urls: ['https://yachting-daily.example/feed']});
        expect(DiscoveryService.phaseOf(1)).toBeNull();
    });

    it('should not look for the press twice for a medium Google News already gave', async () => {
        await DiscoveryService.start(2);
        await until(() => IngestService.run.mock.calls.length === 1);
        answerPress([{site: 'sailworld.example', name: 'Sail World', news: 9, lang: 'en'}]);
        await until(() => statuses().includes('done'));
        expect(saved(1)).toEqual([]);
        expect(IngestService.run).toHaveBeenCalledTimes(1);
    });

    it('should end after Google News when Media Cloud has no key', async () => {
        mediaCloudEnabled.mockReturnValue(false);
        await DiscoveryService.start(3);
        await until(() => statuses().includes('done'));
        expect(ProfileModel.addProfileFeeds).toHaveBeenCalledTimes(1);
        expect(mediaFor).not.toHaveBeenCalled();
    });

    it('should say the discovery failed when the sources of Google News could not be read, once the press is done', async () => {
        IngestService.run.mockRejectedValueOnce(new Error('database down'));
        await DiscoveryService.start(4);
        await until(() => IngestService.run.mock.calls.length === 1);
        expect(statuses()).not.toContain('failed');

        answerPress([]);
        await until(() => statuses().includes('failed'));
        expect(ProfileModel.setDiscovery).toHaveBeenLastCalledWith(4, 'failed', 'database down');
    });
});
