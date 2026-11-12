//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: fifa-controller.js
//  Description: Controller for the map "The FIFA presidency": the map, the sheet of an association, the presidents, the confederations, the candidates
//               (a reader adds one) and the votes of the readers (see fifa-service.js)
//

"use strict"

import {FifaService} from '../services/fifa-service.js';

const fail = (res, error) => res.status(error.status || 500).json({error: error.message ?? String(error)});

export const FifaController = {
    map: async (req, res) => {
        try {
            res.status(200).json(await FifaService.map());
        } catch (error) {
            fail(res, error);
        }
    },

    association: async (req, res) => {
        try {
            res.status(200).json(await FifaService.association(req.params.qid));
        } catch (error) {
            fail(res, error);
        }
    },

    presidents: async (req, res) => {
        try {
            res.status(200).json(await FifaService.presidents());
        } catch (error) {
            fail(res, error);
        }
    },

    confederations: async (req, res) => {
        try {
            res.status(200).json(await FifaService.confederations());
        } catch (error) {
            fail(res, error);
        }
    },

    subjects: async (req, res) => {
        try {
            res.status(200).json(await FifaService.subjects());
        } catch (error) {
            fail(res, error);
        }
    },

    // ?q=: the persons of Wikidata whose name starts so, for the reader who adds a candidate: {people: [{qid, name, description}]}
    people: async (req, res) => {
        try {
            const q = String(req.query.q ?? '').trim();
            if (q.length < 2) throw Object.assign(new Error('q: two letters at least.'), {status: 422});
            res.status(200).json(await FifaService.people(q));
        } catch (error) {
            fail(res, error);
        }
    },

    // {qid, status?}: a reader adds a candidate. 201 {subject, already: false}, 200 {subject, already: true}
    addSubject: async (req, res) => {
        try {
            const {qid, status} = req.body ?? {};
            const answer = await FifaService.addSubject({qid, status, userId: req.user.id});
            res.status(answer.already ? 200 : 201).json(answer);
        } catch (error) {
            fail(res, error);
        }
    },

    // {status}: declared, rumoured, withdrawn
    setStatus: async (req, res) => {
        try {
            await FifaService.setStatus(req.params.qid, req.body?.status);
            res.status(204).end();
        } catch (error) {
            fail(res, error);
        }
    },

    removeSubject: async (req, res) => {
        try {
            await FifaService.removeSubject(req.params.qid);
            res.status(204).end();
        } catch (error) {
            fail(res, error);
        }
    },

    // {subject, member, value: for|against|unknown|withdraw, note?} -> {ok, human}
    vote: async (req, res) => {
        try {
            const {subject, member, value, note} = req.body ?? {};
            res.status(200).json(await FifaService.vote({userId: req.user.id, subject, member, value, note}));
        } catch (error) {
            fail(res, error);
        }
    },

    // {member, subject: a candidate | "none" | "withdraw"}: the reader says which candidate an association leans toward -> {ok, positions, lean}
    lean: async (req, res) => {
        try {
            const {member, subject} = req.body ?? {};
            res.status(200).json(await FifaService.lean({userId: req.user.id, member, subject}));
        } catch (error) {
            fail(res, error);
        }
    },

    // the last audits of the positions shown (an administrator)
    audits: async (req, res) => {
        try {
            res.status(200).json(await FifaService.audits());
        } catch (error) {
            fail(res, error);
        }
    },

    removeVote: async (req, res) => {
        try {
            await FifaService.removeVote(req.params.id);
            res.status(204).end();
        } catch (error) {
            fail(res, error);
        }
    },
};
