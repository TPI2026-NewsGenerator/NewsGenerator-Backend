//
//  Author: Fabian Rostello
//  Date: 04.11.2026
//  File: test.push.js
//  Description: The alerts sent to the devices of a reader: one notification per affair, at most two in three hours for one
//               affair (the rest waits and goes out together), an alert sent once, none for a reader with no device
//

import process from 'node:process';
import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const sendNotification = jest.fn();
jest.unstable_mockModule('web-push', () => ({default: {setVapidDetails: () => {}, sendNotification}}));
const model = {
    unpushed: jest.fn(), subscriptionsOf: jest.fn(), ringsSince: jest.fn(), markPushed: jest.fn(async () => 0),
    pushFailed: jest.fn(async () => {}), pushWorked: jest.fn(async () => {}),
};
jest.unstable_mockModule('../../models/affair-model.js', () => ({AffairModel: model}));
process.env.VAPID_PUBLIC_KEY = 'BPublicKeyForTheTests';
process.env.VAPID_PRIVATE_KEY = 'privateKeyForTheTests';
const {PushService, held} = await import('../../services/push-service.js');

const alert = (id, affair, hours = 1) => ({id, id_affair: affair, title: `Affair ${affair}`, event: {title: `Fact ${id}`, at: new Date(Date.now() - hours * 3600e3).toISOString()}});
const device = {id: 1, endpoint: 'https://push.example/1', p256dh: 'p', auth: 'a', failures: 0};

beforeEach(() => {
    Object.values(model).forEach(fn => fn.mockClear());
    sendNotification.mockReset().mockResolvedValue({});
    model.ringsSince.mockResolvedValue([]);
    model.subscriptionsOf.mockResolvedValue([device]);
});

describe('held', () => {
    it('should hold an affair that rang twice in the window', () => {
        expect([0, 1, 2, 3].map(held)).toEqual([false, false, true, true]);
    });
});

describe('notifyUser', () => {
    it('should send one notification per affair and mark the alerts sent', async () => {
        model.unpushed.mockResolvedValue([alert(1, 10), alert(2, 10), alert(3, 11)]);
        expect(await PushService.notifyUser(7)).toBe(3);
        expect(sendNotification).toHaveBeenCalledTimes(2);
        const bodies = sendNotification.mock.calls.map(([, payload]) => JSON.parse(payload));
        expect(bodies.map(body => body.url).sort()).toEqual(['/affairs/10', '/affairs/11']);
        expect(model.markPushed).toHaveBeenCalledWith(expect.arrayContaining([1, 2, 3]));
    });

    it('should keep the alerts of an affair that rang twice in the window for the next run, and send the others', async () => {
        model.unpushed.mockResolvedValue([alert(1, 10), alert(3, 11)]);
        model.ringsSince.mockResolvedValue([{id_affair: 10, n: 2}]);
        expect(await PushService.notifyUser(7)).toBe(1);
        expect(sendNotification).toHaveBeenCalledTimes(1);
        expect(model.markPushed.mock.calls[0][0]).toEqual([3]);
    });

    it('should leave the alerts unsent when no device took them, and forget a device that is gone', async () => {
        model.unpushed.mockResolvedValue([alert(1, 10)]);
        sendNotification.mockRejectedValue(Object.assign(new Error('gone'), {statusCode: 410}));
        jest.spyOn(console, 'error').mockImplementation(() => {});
        expect(await PushService.notifyUser(7)).toBe(0);
        expect(model.pushFailed).toHaveBeenCalledWith(1, true);
        expect(model.markPushed.mock.calls[0][0]).toEqual([]);
    });

    it('should mark the alerts of a reader with no device as sent, so a device added later is not told old news', async () => {
        model.unpushed.mockResolvedValue([alert(1, 10), alert(2, 11)]);
        model.subscriptionsOf.mockResolvedValue([]);
        expect(await PushService.notifyUser(7)).toBe(0);
        expect(sendNotification).not.toHaveBeenCalled();
        expect(model.markPushed).toHaveBeenCalledWith([1, 2]);
    });

    it('should not ring for an alert over a day old, but be done with it', async () => {
        model.unpushed.mockResolvedValue([alert(1, 10, 30)]);
        expect(await PushService.notifyUser(7)).toBe(0);
        expect(sendNotification).not.toHaveBeenCalled();
        expect(model.markPushed).toHaveBeenCalledWith([1]);
    });
});
