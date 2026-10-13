//
//  Author: Fabian Rostello
//  Date: 13.10.2026
//  File: tagging-service.js
//  Description: The work done in background next to the ingestion: every news read gets the people,
//               organisations and places it names (the taggers, ner/server.py), and the names most
//               met the item of Wikidata they are
//

"use strict"

import {MentionModel} from "../models/mention-model.js";
import {RETENTION_DAYS} from "./feed-service.js";
import {taggerDevice, taggerUrls, tagTexts} from "./utils/tagger.js";
import {cleanMentions} from "./utils/mentions.js";
import {languageOf} from "./utils/language.js";
import {exactItems} from "./utils/wikidata.js";

// Each tagger of NER_URL works on its own, the newest news first, none taken by another: the
// processor of the server (2.2 news a second on 3 cores, 13.10.2026) keeps up with the news of the
// day (1.4 different texts a second), the graphics card switched on now and then takes the backlog
// with it. A news is read once, by whichever takes it first
const BATCH = {cpu: 16, cuda: 128};
// nothing left to tag, or the tagger off: asked again after this
const WAIT_MS = 60e3;
// the news of the retention are tagged, the newest first: older ones are deleted soon
const TAG_DAYS = RETENTION_DAYS;
const REPORT_MINUTES = 60;
const HOUSEKEEPING_HOURS = 24;

// Wikidata is asked which item a name is, the most met names first, once named by LINK_LEAST news (a
// name met once is often a slip of the tagger). Wikidata let 9 or 10 searches through, then answered
// 429 for 12 to 25 s, at one a second as at one every 3 s; one every 6.5 s went through 30 times in a
// row (13.10.2026, without an account): one every LINK_PAUSE_MS, about 12 000 names a day, and the
// pause it asks for after a refusal (see wikidata.js)
const LINK_LEAST = 3;
const LINK_BATCH = 20;
const LINK_PAUSE_MS = 7000;
const LINK_IDLE_MS = 10 * 60e3;

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms).unref?.());

// the news being read by a tagger: the others leave them
const taken = new Set();
// by address: {device, tagged since the last report}
const taggers = new Map();
let started = false;

// What is tagged of a news: the title and the start of its description, longer than what is embedded
// (400 characters): a name further in it was missed (13.10.2026, the user's choice). The rest of a long
// description is mostly the links to other articles of the medium (Čeferin in 30 news of L'Équipe and
// SID, 29 only there)
export const TAGGED_CHARS = 700;
export const textOf = (row) => {
    const description = String(row.description ?? '').replace(/\s+/g, ' ').trim().slice(0, TAGGED_CHARS);
    return description ? `${row.title ?? ''}. ${description}` : row.title ?? '';
};

// These news ({id, title, description, lang}) tagged by this tagger and their names saved. A text met
// twice (a news in two feeds) is sent once
export const tagRows = async (url, rows) => {
    const texts = [...new Set(rows.map(textOf))];
    const found = await tagTexts(url, texts);
    const names = new Map(texts.map((text, i) => [text, cleanMentions(found[i])]));
    await MentionModel.save(rows.map(row => ({
        id: row.id,
        lang: row.lang ?? languageOf(textOf(row), null) ?? null,
        names: names.get(textOf(row)),
    })));
};

// One batch of the newest news not tagged nor taken, tagged by this tagger: how many
export const tagBatch = async (url, device) => {
    const rows = await MentionModel.untagged({since: new Date(Date.now() - TAG_DAYS * 24 * 3600e3), limit: BATCH[device] ?? BATCH.cpu, taken: [...taken]});
    if (rows.length === 0) return 0;
    rows.forEach(row => taken.add(row.id));
    try {
        await tagRows(url, rows);
        return rows.length;
    } finally {
        rows.forEach(row => taken.delete(row.id));
    }
};

// A tagger's loop, for as long as the server lives: a batch after the other while it answers and news
// wait. Off, failing, or with nothing left: asked again after WAIT_MS
const work = async (url) => {
    const state = {device: null, tagged: 0};
    taggers.set(url, state);
    for (;;) {
        const device = await taggerDevice(url);
        if (device !== state.device) {
            console.log(device ? `Tagger: ${url} works (${device === 'cuda' ? 'graphics card' : 'processor'})` : `Tagger: ${url} does not answer`);
            state.device = device;
        }
        if (!device) {
            await wait(WAIT_MS);
            continue;
        }
        try {
            const done = await tagBatch(url, device);
            state.tagged += done;
            if (done === 0) await wait(WAIT_MS);
        } catch (err) {
            console.error(`Tagger: ${url} failed (${err.message})`);
            await wait(WAIT_MS);
        }
    }
};

// The names most met looked for in Wikidata, one at a time: linked when one item only is called so
const link = async () => {
    for (;;) {
        let rows = [];
        try {
            rows = await MentionModel.toLink({least: LINK_LEAST, limit: LINK_BATCH});
        } catch (err) {
            console.error(`Tagger: no name to link read (${err.message})`);
        }
        if (rows.length === 0) {
            await wait(LINK_IDLE_MS);
            continue;
        }
        for (const row of rows) {
            try {
                const qids = await exactItems(row.name, row.lang ?? 'en');
                await MentionModel.setLink(row.id, qids.length === 1 ? qids[0] : null);
            } catch (err) {
                // refused (429): wikidata.js waits the time asked before the next one
                if (!err.paused) console.error(`Tagger: "${row.name}" not looked for in Wikidata (${err.message})`);
            }
            await wait(LINK_PAUSE_MS);
        }
    }
};

// once an hour: what each tagger did, and what is left
const report = async () => {
    for (;;) {
        await wait(REPORT_MINUTES * 60e3);
        try {
            const waiting = await MentionModel.untaggedCount(new Date(Date.now() - TAG_DAYS * 24 * 3600e3));
            const done = [...taggers].map(([url, state]) => `${url} ${state.tagged}`).join(', ');
            console.log(`Tagger: in ${REPORT_MINUTES} min tagged ${done}; ${waiting} news of the last ${TAG_DAYS} days left`);
            taggers.forEach(state => { state.tagged = 0; });
        } catch (err) {
            console.error(`Tagger: nothing reported (${err.message})`);
        }
    }
};

const housekeeping = async () => {
    for (;;) {
        await wait(HOUSEKEEPING_HOURS * 3600e3);
        try {
            const deleted = await MentionModel.deleteUnused();
            if (deleted > 0) console.log(`Tagger: ${deleted} names no news names any more deleted`);
        } catch (err) {
            console.error(`Tagger: unused names not deleted (${err.message})`);
        }
    }
};

export const TaggingService = {
    // every tagger of NER_URL at work, and the names linked, for as long as the server lives. None:
    // nothing runs, the news are not tagged
    schedule: () => {
        const urls = taggerUrls();
        if (started || urls.length === 0) return;
        started = true;
        console.log(`Taggers: ${urls.join(', ')}`);
        urls.forEach(url => work(url));
        link();
        report();
        housekeeping();
    },
};
