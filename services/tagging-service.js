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
import {cleanMentions, mentionKey} from "./utils/mentions.js";
import {languageOf} from "./utils/language.js";
import {exactItems, famousHuman} from "./utils/wikidata.js";
import {countriesOfItems} from "./utils/countries.js";
import {organizationItem} from "./utils/organization-items.js";
import {newUsage} from "./utils/ollama.js";

// Each tagger of NER_URL works on its own, the newest news first, none taken by another: the
// processor of the server (2.2 news a second on 3 cores, 13.10.2026) keeps up with the news of the
// day (1.4 different texts a second), the graphics card switched on now and then takes the backlog
// with it. A news is read once, by whichever takes it first
const BATCH = {cpu: 16, cuda: 128};
// nothing left to tag, or the tagger off: asked again after this
const WAIT_MS = 60e3;
// the news of the retention are tagged, the newest first: older ones are deleted soon
export const TAG_DAYS = RETENTION_DAYS;
const REPORT_MINUTES = 60;
const HOUSEKEEPING_HOURS = 24;

// Wikidata is asked which item a name is, the most met names first, once named by LINK_LEAST news (a
// name met once is often a slip of the tagger). Wikidata let 9 or 10 searches through, then answered
// 429 for 12 to 25 s, at one a second as at one every 3 s; one every 6.5 s went through 30 times in a
// row (13.10.2026, without an account): one every LINK_PAUSE_MS, about 12 000 names a day, and the
// pause it asks for after a refusal (see wikidata.js)
export const LINK_LEAST = 3;
const LINK_BATCH = 20;
const LINK_PAUSE_MS = 7000;
const LINK_IDLE_MS = 10 * 60e3;

// The countries of the items linked (see countries.js), read ahead so a briefing finds them known: a
// card asking Wikidata for its own was refused, the names being linked at the same time (18.10.2026).
// LOCATE_BATCH items a call, one call every LOCATE_PAUSE_MS: the 16 000 items linked before were read
// in about 7 hours
const LOCATE_BATCH = 40;
const LOCATE_PAUSE_MS = 60e3;

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

// the tokens the AI took to tell organisations apart since the last report
let linkUsage = newUsage();

// The names looked for in Wikidata, one at a time, the ones a reader saw first (on a card, the page of
// a name: see MentionModel.want), then the most met: linked when one item only is called so, or, for a
// person, when one of the humans called so is far more known than the others (see famousHuman: one item
// only left 1 186 of 2 130 persons met 100 times or more unlinked, Donald Trump and Messi among them,
// 18.10.2026). An organisation is the one item called so, else the one the AI chooses among the items
// called so or whose name starts so (see organization-items.js)
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
                let qid = null;
                if (row.kind === 'organization') qid = await organizationItem(row, linkUsage);
                else {
                    const qids = await exactItems(row.name, row.lang ?? 'en');
                    // a full name only: "Russell" alone, the F1 driver, became Bertrand Russell (18.10.2026); a
                    // family name alone is told on its card (see withSurnamesLinked)
                    const fullName = mentionKey(row.name).includes(' ');
                    qid = qids.length === 1 ? qids[0] : qids.length > 1 && row.kind === 'person' && fullName ? await famousHuman(qids) : null;
                }
                await MentionModel.setLink(row.id, qid);
            } catch (err) {
                // refused (429): wikidata.js waits the time asked before the next one
                if (!err.paused) console.error(`Tagger: "${row.name}" not looked for in Wikidata (${err.message})`);
            }
            await wait(LINK_PAUSE_MS);
        }
    }
};

const locate = async () => {
    for (;;) {
        try {
            const qids = await MentionModel.toLocate(LOCATE_BATCH);
            if (qids.length === 0) {
                await wait(LINK_IDLE_MS);
                continue;
            }
            await countriesOfItems(qids, {background: true});
        } catch (err) {
            console.error(`Tagger: no country read (${err.message})`);
        }
        await wait(LOCATE_PAUSE_MS);
    }
};

// once an hour: what each tagger did, and what is left
const report = async () => {
    for (;;) {
        await wait(REPORT_MINUTES * 60e3);
        try {
            const waiting = await MentionModel.untaggedCount(new Date(Date.now() - TAG_DAYS * 24 * 3600e3));
            const done = [...taggers].map(([url, state]) => `${url} ${state.tagged}`).join(', ');
            console.log(`Tagger: in ${REPORT_MINUTES} min tagged ${done}; ${waiting} news of the last ${TAG_DAYS} days left`
                + `; organisations told apart by the AI: ${linkUsage.calls} calls, ${linkUsage.input + linkUsage.output} tokens`);
            taggers.forEach(state => { state.tagged = 0; });
            linkUsage = newUsage();
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
        locate();
        report();
        housekeeping();
    },
};
