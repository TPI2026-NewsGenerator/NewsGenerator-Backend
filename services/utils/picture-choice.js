//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: picture-choice.js
//  Description: The picture of a card chosen by the AI among the pictures its articles give (the user, 10.11.2026: the pictures of two cards of the
//               briefing of Enzo were "de très très mauvaise qualité", others were there). The code only reads the width of a picture (see
//               picture-sizes.js): it cannot see a blur, a logo or a picture of another subject. gemma4:31b, which reads pictures, is shown the
//               pictures of a card (the one the card shows and three others at most, as the files are, not scaled) with its title, and gives each
//               a quality (1-5) and a relevance (0-2) and the one it would choose. The AI proposes, the code decides: the card keeps its picture
//               unless the AI gives the other one a quality at least MARGIN above it (a relevance of 0 for the one shown, and not for the other, is
//               enough too). A card changes only for a picture that loaded and was wide enough. It never fails and never waits long: the AI
//               not answering, a picture that does not load, leave the card as it is
//
//  Measured on 60 cards and their 198 pictures, rated blind by two raters (10.11.2026, see docs/briefing/README.md): quality of the pictures
//  shown 3.98 -> 4.17, none of the changes broke a card, 9 to 11 of the 60 changed, the same answer on two runs. Bytes per pixel did not help
//  (3.93), a library of sharpness (Laplacian) chose pictures of another subject (relevance 1.63 against 1.70)
//

"use strict"

import process from 'node:process';
import {Buffer} from 'node:buffer';
import {mapWithConcurrency} from './concurrency.js';
import {newUsage, ollamaJson} from './ollama.js';
import {assertPublicUrl} from './public-url.js';
import {PICTURE_HEADERS, SHARP_WIDTH, isStanding} from './picture-sizes.js';

// a model that reads pictures: gemma4:31b does, as the cloud models of the plan do not all
export const PICTURE_MODEL = process.env.PICTURE_MODEL || 'gemma4:31b';
// the pictures of a card the AI sees, the one shown first
export const CANDIDATES = 4;
// how much better the AI must find another picture to put it in place of the one shown (quality, on 5)
export const MARGIN = 1;
const LETTERS = 'ABCD';
// a picture larger than this is not sent
const MAX_BYTES = 3 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10e3;
const FETCH_TOTAL_MS = 30e3;
const FETCH_AT_ONCE = 8;
const CALLS_AT_ONCE = 3;
const CALL_TIMEOUT_MS = 60e3;
const DEADLINE_MS = 120e3;

// the pictures of a card to look at: the one it shows first, then the others of its articles that are wide enough and on https (a page on https
// blocks the others), four at most. None when the card shows no picture of its articles (its illustration, or none) or has no other
export const candidatesOf = (item) => {
    const pictures = item.pictures ?? [];
    const shown = pictures.find(picture => picture.url === item.thumbnail);
    if (!shown) return [];
    const others = pictures.filter(picture => picture.url !== item.thumbnail && picture.width >= SHARP_WIDTH && !/^http:/i.test(picture.url));
    const candidates = [shown, ...others].slice(0, CANDIDATES);
    return candidates.length >= 2 ? candidates : [];
};

const kindOf = (bytes) => {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
    if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
    return null;
};

// {data (base64), bytes} of the picture at this address, null when it does not load, is no JPEG, PNG or WebP, or is over MAX_BYTES. The app is
// what it says it is: a site that refuses it leaves the card as it is (see ROBOT_REFUSALS of picture-sizes.js)
export const fetchPicture = async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        await assertPublicUrl(url);
        const response = await fetch(url, {headers: PICTURE_HEADERS, signal: controller.signal, redirect: 'follow'});
        if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_BYTES) {
            await response.body?.cancel();
            return null;
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
            size += chunk.length;
            if (size > MAX_BYTES) return null;
            chunks.push(chunk);
        }
        const bytes = Buffer.concat(chunks);
        return kindOf(bytes) ? {data: bytes.toString('base64'), bytes: bytes.length} : null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
};

export const choicePrompt = (title, letters) => `You choose the main picture of a news card. The news: "${title}".
You are given ${letters.length} candidate pictures, in the order ${letters.join(', ')}.
For EACH picture give:
- q (1-5): technical quality shown about 600-900 px wide. 5 = sharp, detailed, clean. 3 = acceptable, some softness or compression. 2 = clearly soft, blurry, noisy or blocky. 1 = very poor (pixelated, smeared, dark mush, upscaled, heavy artifacts).
- r (0-2): relevance to the news. 0 = clearly unrelated (another subject or event, generic stock, a logo of something else). 1 = plausible (logo, building, crowd or archive picture of the right organisation, sport or place). 2 = clearly illustrates this very news.
Then "best": the letter you would choose, balancing quality and relevance (a sharp unrelated picture must not beat a decent relevant one).
Answer with JSON only: {"ratings": {"A": {"q": 4, "r": 2}, ...}, "best": "A"}`;

// {ratings: {letter: {q, r}}, best: letter | null} from what the AI answered: a rating out of its scale, a letter that is none of the pictures
// shown are dropped, as are the words around a letter ("Picture B" is no letter)
export const normalizeAnswer = (answer, letters) => {
    const ratings = {};
    for (const letter of letters) {
        const one = answer?.ratings?.[letter];
        const q = Math.round(Number(one?.q));
        const r = Math.round(Number(one?.r));
        if (q >= 1 && q <= 5 && r >= 0 && r <= 2) ratings[letter] = {q, r};
    }
    const best = String(answer?.best ?? '').trim().toUpperCase().match(/^\W*([A-D])\W*$/)?.[1];
    return {ratings, best: best && letters.includes(best) ? best : null};
};

// The letter of the picture the card shows in the end: the AI's choice only when it finds it better than the one shown by MARGIN, its
// relevance counting for 3 points when it has none; the one shown when the AI gives no rating to one of the two, or the same one
export const chooseLetter = ({ratings, best}, lead = 'A', margin = MARGIN) => {
    const mine = ratings[lead];
    const theirs = ratings[best];
    if (!best || best === lead || !mine || !theirs) return lead;
    if (mine.r === 0 && theirs.r >= 1) return best;
    return theirs.q - (theirs.r >= 1 ? 0 : 3) >= mine.q + margin ? best : lead;
};

// The picture shown is standing, and the AI rates a wide one as good as it, relevant: the wide one (the user, 10.11.2026, a friend: a portrait photo in
// the card and the e-mail). The best rated of the wide ones, the AI's choice first when it is one; the letter of the picture shown else.
// wide: the letters of the pictures that are not standing
export const wideForStanding = ({ratings, best}, lead, wide) => {
    const mine = ratings[lead];
    if (!mine || wide.includes(lead)) return lead;
    const equal = wide.filter(letter => ratings[letter] && ratings[letter].q >= mine.q && ratings[letter].r >= Math.max(1, mine.r));
    return equal.sort((a, b) => (b === best) - (a === best) || ratings[b].q - ratings[a].q || ratings[b].r - ratings[a].r || a.localeCompare(b))[0] ?? lead;
};

// The letters of the pictures of a card, turned by its story so that the picture shown is not always the "A" (a model may favour the first)
const lettersOf = (storyId, count) => {
    const turn = Math.abs(Number(storyId) || 0) % count;
    return Array.from({length: count}, (_, i) => LETTERS[(i + turn) % count]);
};

// one card judged: the change to make ({storyId, thumbnail, thumbnailSource, from, fromSource, scores}) or {skipped: why} or null (the card stays)
const judge = async ({item, candidates}, fetched, tokens) => {
    const lead = candidates[0];
    if (!fetched.get(lead.url)) return {skipped: 'the picture shown did not load'};
    const loaded = candidates.filter(candidate => fetched.get(candidate.url));
    if (loaded.length < 2) return {skipped: 'fewer than two pictures loaded'};
    const letters = lettersOf(item.storyId, loaded.length);
    const byLetter = new Map(loaded.map((candidate, i) => [letters[i], candidate]));
    const sorted = [...byLetter.keys()].sort();
    const prompt = [{role: 'user', content: choicePrompt(item.titleTranslation ?? item.title, sorted), images: sorted.map(letter => fetched.get(byLetter.get(letter).url).data)}];
    let answer = null;
    for (let attempt = 0; attempt < 2 && !answer; attempt++) {
        try {
            answer = await ollamaJson(prompt, tokens, {model: PICTURE_MODEL, fallback: null, think: false, timeoutMs: CALL_TIMEOUT_MS});
        } catch (err) {
            if (attempt === 1) throw err;
        }
    }
    const read = normalizeAnswer(answer, sorted);
    const leadLetter = letters[0];
    // the margin is one point less to put a wide picture in place of a standing one, one more to put a standing one in place of a wide one
    const standingOf = (letter) => isStanding(byLetter.get(letter));
    const adjust = (standingOf(leadLetter) ? -1 : 0) + (read.best && read.best !== leadLetter && standingOf(read.best) && !standingOf(leadLetter) ? 1 : 0);
    let chosen = chooseLetter(read, leadLetter, MARGIN + adjust);
    if (chosen === leadLetter && standingOf(leadLetter)) chosen = wideForStanding(read, leadLetter, sorted.filter(letter => !standingOf(letter)));
    if (chosen === leadLetter) return null;
    const picture = byLetter.get(chosen);
    return {storyId: item.storyId, thumbnail: picture.url, thumbnailSource: picture.source ?? null, from: lead.url, fromSource: item.thumbnailSource ?? null,
        scores: {shown: read.ratings[leadLetter], chosen: read.ratings[chosen]}};
};

const short = (text, length) => String(text ?? '').replace(/\s+/g, ' ').slice(0, length);

// Map storyId -> the change of picture of the cards the AI found a better one for (see judge). 'label': the briefing, for the log. Never throws
export const choosePictures = async (items, {usage = null, label = 'unsaved', log = console} = {}) => {
    const changes = new Map();
    if (process.env.AI_PICTURES === 'off') return changes;
    const asked = items.map(item => ({item, candidates: candidatesOf(item)})).filter(card => card.candidates.length > 0);
    if (asked.length === 0) return changes;
    const tokens = usage ?? newUsage();
    const started = Date.now();
    let timer;
    try {
        const reading = (async () => {
            const fetched = new Map();
            const until = Date.now() + FETCH_TOTAL_MS;
            const urls = [...new Set(asked.flatMap(card => card.candidates.map(candidate => candidate.url)))];
            await mapWithConcurrency(urls, FETCH_AT_ONCE, async (url) => {
                if (Date.now() < until) fetched.set(url, await fetchPicture(url));
            });
            return mapWithConcurrency(asked, CALLS_AT_ONCE, card => judge(card, fetched, tokens));
        })();
        const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer in ${DEADLINE_MS / 1e3} s`)), DEADLINE_MS); });
        const results = await Promise.race([reading, late]);
        let skipped = 0;
        results.forEach((result, i) => {
            const card = short(asked[i].item.titleTranslation ?? asked[i].item.title, 50);
            if (result.status === 'rejected') {
                log.error(`Briefing ${label}: pictures: the card "${card}" was not looked at (${result.reason?.message})`);
            } else if (result.value?.skipped) {
                skipped++;
            } else if (result.value) {
                changes.set(result.value.storyId, result.value);
                const {shown, chosen} = result.value.scores;
                log.log(`Briefing ${label}: pictures: the picture of "${card}" changed (quality ${shown?.q} -> ${chosen?.q}, relevance ${shown?.r} -> ${chosen?.r}): ${short(result.value.from, 70)} -> ${short(result.value.thumbnail, 70)}`);
            }
        });
        log.log(`Briefing ${label}: pictures: ${asked.length} cards looked at in ${Math.round((Date.now() - started) / 1000)} s (tokens ${JSON.stringify(tokens)}), ${changes.size} changed, ${skipped} left as they were (a picture did not load)`);
    } catch (err) {
        log.error(`Briefing ${label}: the pictures were not chosen by the AI (${err.message})`);
        changes.clear();
    } finally {
        clearTimeout(timer);
    }
    return changes;
};

// The cards with the pictures chosen (see choosePictures): the picture and its site, and what it replaced, to say so on the card
export const withAiPictures = (items, changes) => changes.size === 0 ? items : items.map(item => {
    const change = changes.get(item.storyId);
    return change ? {...item, thumbnail: change.thumbnail, thumbnailSource: change.thumbnailSource,
        pictureChosen: {from: change.from, fromSource: change.fromSource, scores: change.scores}} : item;
});
