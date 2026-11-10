//
//  Author: Fabian Rostello
//  Date: 09.11.2026
//  File: test.card-versions.js
//  Description: The same news written by another profile of the account, and a card replaced by it where it stands (card-versions.js,
//               BriefingService.versions, useVersion and restoreVersion)
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const ofUser = jest.fn();
const versionsOf = jest.fn(async () => []);
const replaceCard = jest.fn(async () => 1);
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
jest.unstable_mockModule('../../services/entity-service.js', () => ({EntityService: {
    followTerms: async (profileId, words) => (words ?? []).map(word => ({label: word, qid: null, names: [word]})),
}}));
jest.unstable_mockModule('../../models/briefing-model.js', () => ({BriefingModel: {ofUser, versionsOf, replaceCard}}));
const profiles = {3: {name: 'Roberto', languages: ['en'], watch_terms: ['Wenger']}, 4: {name: 'Chris', languages: ['en'], watch_terms: []},
    5: {name: 'Enzo', languages: ['fr'], watch_terms: []}};
jest.unstable_mockModule('../../models/profile-model.js', () => ({ProfileModel: {get: jest.fn(async (id) => profiles[id] ?? null)}}));
const {areVersions, idsOf, restoredCard, swappedCard, versionsOfCards, forThePage} = await import('../../services/utils/card-versions.js');
const {BriefingService} = await import('../../services/briefing-service.js');

// a card as a briefing saves it, as written by the profile it is of
const card = (storyId, source, extra = {}) => ({storyId, mergedStoryIds: [], title: `Wenger by ${source}`, why: `Why for ${source}`, interest: `interest of ${source}`, project: null,
    followUp: null, vote: null, feedUrls: [`https://${source}/rss`], lead: {source, url: `https://${source}/wenger`}, summary: `Passages of ${source}.`,
    points: `Points of ${source}.`, thumbnail: `https://${source}/p.jpg`, articles: [{url: `https://${source}/wenger`}], angles: [{title: `Angle of ${source}`}], ...extra});

describe('versionsOfCards', () => {
    const items = [card(10, 'lesoir.be', {mergedStoryIds: [11]}), card(20, 'bbc.co.uk'), card(-1, 'added.example', {imported: true})];
    const row = (idProfile, briefingId, createdAt, storyId, leadUrl, mergedStoryIds = []) => ({idProfile, briefingId, createdAt, storyId, mergedStoryIds,
        title: `Wenger by ${leadUrl}`, leadUrl, source: leadUrl});

    it('should give the version another profile has of a card, by its story or by one of the stories merged into it', () => {
        // 507: a card whose own story is the one merged into this card (11); 508: the same story
        const versions = versionsOfCards(items, [row(4, 508, '2026-11-09T07:23:00Z', 10, 'https://hln.be/wenger'), row(3, 507, '2026-11-09T07:16:00Z', 11, 'https://x.example/a')]);
        expect(versions[10].map(one => one.briefingId)).toEqual([508, 507]);
        expect(versions[20]).toBeUndefined();
        // and the other way: this card is one of the stories merged into the card of the other
        expect(versionsOfCards([card(11, 'lesoir.be')], [row(4, 508, '2026-11-09T07:23:00Z', 10, 'https://hln.be/wenger', [11])])[11].map(one => one.briefingId)).toEqual([508]);
    });

    it('should not give as a version a card that only shares with this one a story merged into both: it may be a news joined by mistake', () => {
        // the cards of Enzo (card 28, the outburst of Leko) and Roberto (card 12, the comment of Lardot on the goal of the same match) of 10.11.2026:
        // the story of Leko (2454827) was merged into the card of Lardot by mistake
        const enzo = card(2433748, 'jutarnji.hr', {mergedStoryIds: [2454827]});
        const roberto = row(4, 657, '2026-11-10T07:08:00Z', 2469527, 'https://dhnet.be/lardot', [2427405, 2454827]);
        expect(versionsOfCards([enzo], [roberto])).toEqual({});
        expect(areVersions(enzo, roberto)).toBe(false);
        // the same news, each profile having its own story of it: each of them has the other's story merged into its card
        expect(areVersions(card(10, 'a', {mergedStoryIds: [11]}), card(11, 'b', {mergedStoryIds: [10]}))).toBe(true);
        expect(areVersions(card(10, 'a'), card(10, 'b'))).toBe(true);
        expect(areVersions(card(-1, 'a'), card(-1, 'b'))).toBe(false);
    });

    it('should give one version a profile, the one of its newest briefing, and none with the same lead article', () => {
        const versions = versionsOfCards(items, [
            row(4, 400, '2026-11-08T07:00:00Z', 10, 'https://old.example/wenger'),
            row(4, 508, '2026-11-09T07:23:00Z', 10, 'https://hln.be/wenger'),
            row(3, 507, '2026-11-09T07:16:00Z', 10, 'https://lesoir.be/wenger')]);
        expect(versions[10].map(one => [one.idProfile, one.briefingId])).toEqual([[4, 508]]);
    });

    it('should leave out a profile that does not read in the language of the briefing, and the news the reader added', () => {
        const versions = versionsOfCards(items, [row(5, 600, '2026-11-09T07:00:00Z', 10, 'https://lemonde.fr/wenger'), row(4, 508, '2026-11-09T07:23:00Z', -1, 'https://added.example/b')],
            idProfile => idProfile !== 5);
        expect(versions).toEqual({});
    });
});

describe('swappedCard and restoredCard', () => {
    const mine = card(10, 'lesoir.be', {mergedStoryIds: [11], vote: 'up', sentAt: '2026-11-09T08:00:00Z', ownTitle: 'My own title'});
    const theirs = card(10, 'hln.be', {mergedStoryIds: [12], vote: 'down', why: 'Chosen for Chris', ownText: ['Chris wrote this'], marks: {title: [[0, 6]]}, found: [{term: 'Wenger'}]});
    const from = {briefingId: 508, idProfile: 4, profile: 'Chris', createdAt: '2026-11-09T07:23:00Z'};

    it('should bring the whole version of the other profile and keep what belongs to this briefing: its story, why, thumb, mark of e-mail', () => {
        const swapped = swappedCard(mine, theirs, from, {why: ['mine']});
        expect(swapped).toMatchObject({storyId: 10, mergedStoryIds: [11], title: 'Wenger by hln.be', summary: 'Passages of hln.be.', points: 'Points of hln.be.',
            thumbnail: 'https://hln.be/p.jpg', lead: {source: 'hln.be'}, angles: [{title: 'Angle of hln.be'}],
            why: 'Why for lesoir.be', interest: 'interest of lesoir.be', vote: 'up', sentAt: '2026-11-09T08:00:00Z', feedUrls: ['https://lesoir.be/rss']});
        // not what the reader of the other briefing wrote for its e-mail, nor its marks (marked again for this profile)
        expect(swapped.ownTitle).toBeUndefined();
        expect(swapped.ownText).toBeUndefined();
        expect(swapped.marks).toBeUndefined();
        expect(swapped.found).toBeUndefined();
        expect(swapped.version).toEqual(from);
        expect(swapped.previousVersion).toEqual({card: mine, lines: {why: ['mine']}});
    });

    it('should bring the card back as this profile wrote it, with the thumb it has now', () => {
        const swapped = {...swappedCard(mine, theirs, from), vote: 'down'};
        const back = restoredCard(swapped);
        expect(back).toEqual({...mine, vote: 'down'});
        expect(back.version).toBeUndefined();
        expect(back.previousVersion).toBeUndefined();
        expect(restoredCard(mine)).toBeNull();
    });

    it('should keep the first card as the way back when it is replaced again, by a third version', () => {
        const once = swappedCard(mine, theirs, from);
        const twice = swappedCard(once, card(10, 'goal.com'), {briefingId: 506, idProfile: 5, profile: 'Enzo'});
        expect(twice.title).toBe('Wenger by goal.com');
        expect(twice.version.briefingId).toBe(506);
        expect(restoredCard(twice)).toEqual(mine);
    });

    it('should tell the page only which card was replaced, not send it', () => {
        const page = forThePage(swappedCard(mine, theirs, from));
        expect(page.previousVersion).toEqual({title: 'Wenger by lesoir.be', source: 'lesoir.be'});
        expect(forThePage(mine)).toBe(mine);
        expect(idsOf(mine)).toEqual([10, 11]);
    });
});

describe('BriefingService.versions, useVersion and restoreVersion', () => {
    const analysis = (cards) => ({status: 'ready', cards});
    const here = {id: 507, id_profile: 3, status: 'ready', items: [card(10, 'lesoir.be', {mergedStoryIds: [11]}), card(20, 'bbc.co.uk')],
        analysis: analysis({10: {why: ['mine'], next: []}}), created_at: new Date('2026-11-09T07:16:00Z')};
    const there = {id: 508, id_profile: 4, status: 'ready', items: [card(10, 'hln.be')], analysis: analysis({10: {why: ['theirs'], next: []}}),
        created_at: new Date('2026-11-09T07:23:00Z')};

    beforeEach(() => {
        ofUser.mockReset().mockImplementation(async (userId, id) => ({507: here, 508: there, 600: {...there, id: 600, id_profile: 5}}[id] ?? null));
        versionsOf.mockReset().mockResolvedValue([]);
        replaceCard.mockReset().mockResolvedValue(1);
    });

    it('should list the versions the other profiles have, with their names', async () => {
        versionsOf.mockResolvedValue([{idProfile: 4, briefingId: 508, createdAt: '2026-11-09T07:23:00Z', storyId: 10, mergedStoryIds: [], title: 'Wenger by hln.be',
            leadUrl: 'https://hln.be/wenger', source: 'hln.be'}, {idProfile: 3, briefingId: 400, createdAt: '2026-11-08T07:00:00Z', storyId: 10, mergedStoryIds: [],
            title: 'Wenger', leadUrl: 'https://other.example/w', source: 'other.example'}]);
        const {versions} = await BriefingService.versions(482, 507);
        // not the briefings of the profile itself
        expect(versions).toEqual({10: [{briefingId: 508, idProfile: 4, createdAt: '2026-11-09T07:23:00Z', title: 'Wenger by hln.be', source: 'hln.be', profile: 'Chris'}]});
        expect(versionsOf).toHaveBeenCalledWith(482, 507, [10, 11, 20], 7);
    });

    it('should replace the card where it stands with the version of the other briefing and its analysis, the way back kept', async () => {
        const {item, analysis: lines} = await BriefingService.useVersion(482, 507, 10, 508);
        expect(replaceCard).toHaveBeenCalledTimes(1);
        const [userId, briefingId, storyId, saved, options] = replaceCard.mock.calls[0];
        expect([userId, briefingId, storyId]).toEqual([482, 507, 10]);
        expect(saved).toMatchObject({storyId: 10, mergedStoryIds: [11], title: 'Wenger by hln.be', version: {briefingId: 508, profile: 'Chris'}});
        expect(saved.previousVersion.card.title).toBe('Wenger by lesoir.be');
        expect(saved.previousVersion.lines).toEqual({why: ['mine'], next: []});
        expect(options).toEqual({lines: {why: ['theirs'], next: []}, setLines: true});
        // what the page gets: the card marked with what the profile follows, the card it replaced only named
        expect(item.title).toBe('Wenger by hln.be');
        expect(item.marks.title).toEqual([[0, 6]]);
        expect(item.previousVersion).toEqual({title: 'Wenger by lesoir.be', source: 'lesoir.be'});
        expect(lines).toEqual({why: ['theirs'], next: []});
    });

    it('should leave the analysis as it is when the other briefing has none for the card', async () => {
        ofUser.mockImplementation(async (userId, id) => ({507: here, 508: {...there, analysis: null}}[id] ?? null));
        const {analysis: lines} = await BriefingService.useVersion(482, 507, 10, 508);
        expect(replaceCard.mock.calls[0][4]).toEqual({lines: null, setLines: false});
        expect(lines).toEqual({why: ['mine'], next: []});
    });

    it('should refuse a version that is not of this news, of the same briefing, of another language, or of a card that is not there', async () => {
        ofUser.mockImplementation(async (userId, id) => ({507: here, 508: {...there, items: [card(77, 'hln.be')]}, 600: {...there, id: 600, id_profile: 5}}[id] ?? null));
        await expect(BriefingService.useVersion(482, 507, 10, 508)).rejects.toMatchObject({status: 404});
        await expect(BriefingService.useVersion(482, 507, 10, 600)).rejects.toMatchObject({status: 409});
        await expect(BriefingService.useVersion(482, 507, 10, 507)).rejects.toMatchObject({status: 409});
        await expect(BriefingService.useVersion(482, 507, 99, 508)).rejects.toMatchObject({status: 404});
        await expect(BriefingService.useVersion(482, 507, 10, 999)).rejects.toMatchObject({status: 404});
        await expect(BriefingService.useVersion(482, 507, 'x', 508)).rejects.toMatchObject({status: 400});
        expect(replaceCard).not.toHaveBeenCalled();
    });

    it('should refuse a card that only shares a story merged into both with this one, which the page does not offer either', async () => {
        // here: story 10 with 11 merged; there: story 99 with 11 merged too (a story joined to both cards, to one of them perhaps by mistake)
        ofUser.mockImplementation(async (userId, id) => ({507: here, 508: {...there, items: [card(99, 'hln.be', {mergedStoryIds: [11]})]}}[id] ?? null));
        await expect(BriefingService.useVersion(482, 507, 10, 508)).rejects.toMatchObject({status: 404});
        expect(replaceCard).not.toHaveBeenCalled();
    });

    it('should bring the card back as it was, with its analysis, and refuse one that was never replaced', async () => {
        await expect(BriefingService.restoreVersion(482, 507, 10)).rejects.toMatchObject({status: 404});

        await BriefingService.useVersion(482, 507, 10, 508);
        const swapped = replaceCard.mock.calls[0][3];
        ofUser.mockImplementation(async (userId, id) => id === 507 ? {...here, items: [{...swapped, vote: 'up'}, here.items[1]]} : null);
        replaceCard.mockClear();

        const {item, analysis: lines} = await BriefingService.restoreVersion(482, 507, 10);
        const [, , storyId, restored, options] = replaceCard.mock.calls[0];
        expect(storyId).toBe(10);
        expect(restored).toEqual({...here.items[0], vote: 'up'});
        expect(options).toEqual({lines: {why: ['mine'], next: []}, setLines: true});
        expect(item.title).toBe('Wenger by lesoir.be');
        expect(item.version).toBeUndefined();
        expect(lines).toEqual({why: ['mine'], next: []});
    });
});
