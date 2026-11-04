//
//  Author: Fabian Rostello
//  Date: 04.11.2026
//  File: push-service.js
//  Description: The alerts of the affairs a reader follows sent to their devices (web push): a browser, or the web app
//               put on the home screen of an iPhone (iOS 16.4 and later), which the page allowed with a button
//

"use strict"

import process from 'node:process';
import webpush from 'web-push';
import {AffairModel} from '../models/affair-model.js';

// The keys of the server are made once by "npx web-push generate-vapid-keys" and put in api.env (VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY). Without them nothing is sent and the page says so; the alerts are still in the page.
// The subject is the contact of whoever runs THIS server, not of a reader: the push services of Apple and Google read it when
// something goes wrong with what the server sends. VAPID_SUBJECT, else WIKIDATA_CONTACT (the same contact), else the public site
// a "mailto:" or an https address, as the push services want it
export const subjectOf = (contact) => /^(mailto:|https:\/\/)/.test(contact) ? contact : contact.includes('@') ? `mailto:${contact}` : `https://${contact}`;

const keys = () => ({
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    subject: subjectOf(process.env.VAPID_SUBJECT || process.env.WIKIDATA_CONTACT || 'https://news.fabianrostello.com'),
});
let configured = false;
const ready = () => {
    const {publicKey, privateKey, subject} = keys();
    if (!publicKey || !privateKey) return false;
    if (!configured) {
        webpush.setVapidDetails(subject, publicKey, privateKey);
        configured = true;
    }
    return true;
};

// an alert older than this is not sent: a phone that was off for a day would ring for old news, they are in the page
const TOO_OLD_MS = 24 * 3600e3;
// kept by the push service this long when the device is off: after, the news is stale
const TTL_SECONDS = 6 * 3600;
// An affair that spreads (a cyberattack hitting one country after another: 10 alerts in two days on 4.11.2026) must not ring the
// phone each time: at most MAX_RINGS notifications for one affair in WINDOW_MS, the alerts that come meanwhile wait and go out
// together as one list when the window has room. Every alert stays in the page
const WINDOW_MS = 3 * 3600e3;
const MAX_RINGS = 2;
export const held = (rings) => rings >= MAX_RINGS;
const BODY_CHARS = 140;
const SHOWN = 3;

// what a device is told, one notification per affair: its name, the facts, the page it opens. Pure, for the tests
export const messageOf = (affair, alerts) => {
    const titles = alerts.map(alert => alert.event.titleTranslation ?? alert.event.title);
    const body = alerts.length === 1 ? titles[0]
        : `${titles.slice(0, SHOWN).map(title => `• ${title}`).join('\n')}${alerts.length > SHOWN ? `\n+ ${alerts.length - SHOWN} more` : ''}`;
    return {title: affair.title, body: body.slice(0, BODY_CHARS * SHOWN), url: `/affairs/${affair.id}`, tag: `affair-${affair.id}`};
};

export const PushService = {
    enabled: () => ready(),
    publicKey: () => keys().publicKey ?? null,

    // the device of the reader, as the browser gave it ({endpoint, keys: {p256dh, auth}})
    subscribe: async (userId, subscription, userAgent = null) => {
        const {endpoint, keys: {p256dh, auth} = {}} = subscription ?? {};
        if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth) {
            throw Object.assign(new Error('Not a push subscription.'), {status: 400});
        }
        await AffairModel.saveSubscription({userId, endpoint, p256dh, auth, userAgent: userAgent?.slice(0, 300) ?? null});
    },

    unsubscribe: (userId, endpoint) => AffairModel.deleteSubscription(userId, endpoint),

    // the alerts not yet sent to this reader, to every device of theirs, one notification per affair. An alert is sent
    // once, when a device took it; none when they have no device (they are in the page); a device gone for good is
    // forgotten. Answers how many alerts were sent
    notifyUser: async (userId) => {
        const alerts = await AffairModel.unpushed(userId);
        if (alerts.length === 0) return 0;
        const fresh = alerts.filter(alert => Date.now() - new Date(alert.event.at).getTime() < TOO_OLD_MS);
        const subscriptions = await AffairModel.subscriptionsOf(userId);
        // nobody to tell, or only news too old to ring for: done with them
        if (!ready() || subscriptions.length === 0 || fresh.length === 0) {
            await AffairModel.markPushed(alerts.map(alert => alert.id));
            return 0;
        }
        // an affair that rang MAX_RINGS times in the window waits: its alerts stay for the next run
        const rang = new Map((await AffairModel.ringsSince(userId, new Date(Date.now() - WINDOW_MS))).map(row => [row.id_affair, row.n]));
        const byAffair = new Map([...Map.groupBy(fresh, alert => alert.id_affair)].filter(([id]) => !held(rang.get(id) ?? 0)));
        const taken = new Set();
        for (const subscription of subscriptions) {
            const device = {endpoint: subscription.endpoint, keys: {p256dh: subscription.p256dh, auth: subscription.auth}};
            for (const [id, group] of byAffair) {
                try {
                    await webpush.sendNotification(device, JSON.stringify(messageOf({id, title: group[0].title}, group)), {TTL: TTL_SECONDS, urgency: 'high'});
                    taken.add(id);
                    await AffairModel.pushWorked(subscription.id);
                } catch (err) {
                    const gone = err.statusCode === 404 || err.statusCode === 410;
                    console.error(`Push: device ${subscription.id} of the user ${userId} did not take it (${err.statusCode ?? err.message})`);
                    await AffairModel.pushFailed(subscription.id, gone);
                    if (gone) break;
                }
            }
        }
        // the old ones are done with whatever happens; the new ones when a device took them: else asked again at the next run,
        // the ones of an affair that is held too
        const sent = alerts.filter(alert => fresh.includes(alert) && taken.has(alert.id_affair));
        await AffairModel.markPushed([...alerts.filter(alert => !fresh.includes(alert)), ...sent].map(alert => alert.id));
        return sent.length;
    },
};
