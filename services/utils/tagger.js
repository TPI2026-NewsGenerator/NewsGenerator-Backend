//
//  Author: Fabian Rostello
//  Date: 13.10.2026
//  File: tagger.js
//  Description: The taggers (ner/server.py): where they answer, what they run on, and the names they
//               find in texts
//

"use strict"

import process from 'node:process'

// NER_URL lists them, separated by commas ("http://gaming-pc:8021,http://server:8021"): each one that
// answers takes its own news (see tagging-service.js). None: the news are not tagged
export const taggerUrls = () => (process.env.NER_URL ?? '')
    .split(',').map(url => url.trim().replace(/\/+$/, '')).filter(Boolean);

// the secret of the taggers, the one of the embedders when they share it
const HEADERS = () => {
    const token = process.env.NER_TOKEN || process.env.EMBEDDER_TOKEN;
    return {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})};
};
const HEALTH_TIMEOUT_MS = 2000;
// a batch of the processor takes 8 s, 40 when the machine is busy: fetch gives up at 300 s anyway
const TIMEOUT_MS = 280 * 1000;

// 'cpu' or 'cuda' when the tagger answers, null when it does not
export const taggerDevice = async (url) => {
    try {
        const res = await fetch(`${url}/health`, {signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)});
        if (!res.ok) return null;
        const {device} = await res.json().catch(() => ({}));
        return device === 'cuda' ? 'cuda' : 'cpu';
    } catch {
        return null;
    }
};

// Japanese has no space between its words, and the tagger (GLiNER) cuts a text at the spaces: a whole clause is one word to it and comes back as
// one name ("PSV佐野航大が今季初アシスト" an organisation, "インファンティーノ現会長に批判集まる中" a person of 5 news, 0 of 2 597 Japanese persons
// linked). The text is sent with a break between the runs of katakana, hiragana, han and Latin letters or digits, the edges of the words of a
// headline ("PSV|佐野航大|が|今季初|アシスト"): on 40 Japanese news 22 persons of 10 characters on average, 56 of 6 with the breaks (11.11.2026,
// bench/cjk-names). The break is a no-break space, which the tagger takes for a space and which no name of the news holds (the news' own become
// spaces); it is taken out of the names that come back. Hangul is left alone (Korean has its spaces, and a particle cannot be told from the end
// of a name by the letters: see nameForms) and so is han alone (Chinese: no change of alphabet to cut at)
export const BREAK = '\u00a0';
const RUNS = [
    /[\u30a0-\u30ff\u31f0-\u31ff\uff66-\uff9f]/,    // katakana, with the prolonged sound mark and the middle dot of a foreign name
    /[\u3041-\u309f]/,                              // hiragana
    /[\u3400-\u4dbf\u4e00-\u9fff々〆]/,              // han
    /[A-Za-z0-9\uff10-\uff19\uff21-\uff3a\uff41-\uff5a]/,   // Latin letters and digits, full width too
];
export const withScriptBreaks = (text) => {
    let sent = '';
    let before = -1;
    for (const char of String(text ?? '').replaceAll(BREAK, ' ')) {
        const run = RUNS.findIndex(pattern => pattern.test(char));
        if (run !== -1 && before !== -1 && run !== before) sent += BREAK;
        sent += char;
        before = run;
    }
    return sent;
};
export const withoutBreaks = (text) => String(text ?? '').replaceAll(BREAK, '');

// [[{text, label, score}]]: the names of each text, in the same order. A text cut inside a character
// (a description cut inside an emoji) is sent with the replacement character
export const tagTexts = async (url, texts) => {
    const res = await fetch(`${url}/entities`, {
        method: 'POST',
        headers: HEADERS(),
        body: JSON.stringify({texts: texts.map(text => withScriptBreaks(text.toWellFormed()))}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) throw Object.assign(new Error(`The tagger at ${url} refused the token: NER_TOKEN must be the same on both sides.`), {status: 502});
    if (!res.ok) throw Object.assign(new Error(`The tagger at ${url} failed: HTTP ${res.status}`), {status: 502});
    const {entities} = await res.json();
    if (!Array.isArray(entities) || entities.length !== texts.length) throw Object.assign(new Error(`The tagger at ${url} answered no list of names.`), {status: 502});
    return entities.map(found => Array.isArray(found)
        ? found.map(entity => typeof entity?.text === 'string' ? {...entity, text: withoutBreaks(entity.text)} : entity)
        : found);
};
