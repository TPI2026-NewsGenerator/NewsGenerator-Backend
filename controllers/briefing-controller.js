//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: briefing-controller.js
//  Description: Controller for the daily briefing
//

"use strict"

import {BriefingService} from '../services/briefing-service.js';
import {mailEnabled} from '../services/utils/mailer.js';
import {isAdmin} from '../services/utils/admin.js';

export const BriefingController = {
    // the last briefing, null when none was ever written
    latest: async (req, res) => {
        try {
            // mail: the server can send a briefing by e-mail, and this reader may (see admin.js)
            const [briefing, admin] = await Promise.all([BriefingService.latest(req.profileId), isAdmin(req.user.id)]);
            res.status(200).json({briefing, mail: mailEnabled() && admin});
        } catch (error) {
            res.status(error.status || 500).json({error: error.message ?? String(error)});
        }
    },

    // {storyIds, to?, pictures?, titles?, removed?}: the cards of the briefing the reader ticked, sent to
    // the address to, else to the one of their account, with the pictures and titles they chose, without
    // the denials and other angles they took out
    email: async (req, res) => {
        try {
            const {storyIds, to, pictures, titles, removed} = req.body ?? {};
            // the address of the site as the reader reached it (https through the tunnel, see trust proxy
            // in app.js): the link to the copy of the e-mail kept as it was sent
            const host = req.get('host') ?? '';
            const origin = /^[\w.-]+(:\d+)?$/.test(host) ? `${req.protocol}://${host}` : null;
            await BriefingService.email(req.user.id, req.params.id, storyIds, to, pictures, titles, removed, origin);
            res.status(204).end();
        } catch (error) {
            res.status(error.status || 500).json({error: error.message ?? String(error)});
        }
    },

    // the copy of an e-mail kept as it was sent, a page for anyone who has its link. Its pictures are the
    // ones of the web and the ones joined, written in it; nothing in it runs, and no other site frames it.
    // sandbox: the page is of no site (an opaque origin), so even a script let through by mistake could
    // neither read the session nor call the API; its links still open, in a new tab as articles of their own
    original: async (req, res) => {
        res.set({
            'Content-Security-Policy': "default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox allow-popups allow-popups-to-escape-sandbox",
            'Referrer-Policy': 'no-referrer',
            'X-Robots-Tag': 'noindex, nofollow',
            'Cache-Control': 'private, no-cache',
        });
        try {
            const {html} = await BriefingService.original(req.params.token);
            res.status(200).type('html').send(html);
        } catch (error) {
            const message = error.status === 404 ? 'No e-mail has this address.' : 'The e-mail could not be read, try again later.';
            res.status(error.status || 500).type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>NewsGenerator</title></head><body style="font:17px/1.6 Georgia,serif;margin:48px 16px;color:#1A1815;background:#FBF9F4"><p>${message}</p></body></html>`);
        }
    },

    // the pictures of a card the reader can put in an e-mail instead of its own
    pictures: async (req, res) => {
        try {
            res.status(200).json({pictures: await BriefingService.pictures(req.user.id, req.params.id, req.params.storyId)});
        } catch (error) {
            res.status(error.status || 500).json({error: error.message ?? String(error)});
        }
    },

    // {storyId, vote}: the thumb of the reader on a card, vote null takes it back
    vote: async (req, res) => {
        try {
            await BriefingService.vote(req.user.id, req.params.id, req.body?.storyId, req.body?.vote ?? null);
            res.status(204).end();
        } catch (error) {
            res.status(error.status || 500).json({error: error.message ?? String(error)});
        }
    },

    // {hours, size}: a new briefing of the news of the last hours, of 'size' cards, written in
    // background: 202 with the briefing running, asked again until ready
    start: async (req, res) => {
        try {
            res.status(202).json({briefing: await BriefingService.start(req.user.id, req.profileId, req.body?.hours ?? undefined, req.body?.size ?? undefined)});
        } catch (error) {
            res.status(error.status || 500).json({error: error.message ?? String(error)});
        }
    },
};
