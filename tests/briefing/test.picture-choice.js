//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: test.picture-choice.js
//  Description: The picture of a card chosen by the AI (picture-choice.js): which pictures it is shown, how its answer is read, when the card
//               changes its picture, and that nothing it does can fail a briefing
//

import process from 'node:process';
import {Buffer} from 'node:buffer';
import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';

const ollamaJson = jest.fn();
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson, newUsage: () => ({calls: 0, input: 0, output: 0})}));
jest.unstable_mockModule('../../services/utils/public-url.js', () => ({
    assertPublicUrl: jest.fn(async (value) => {
        if (value.includes('private')) throw Object.assign(new Error('private'), {status: 400});
        return new URL(value);
    }),
}));
const {CANDIDATES, candidatesOf, chooseLetter, choicePrompt, choosePictures, fetchPicture, normalizeAnswer, wideForStanding, withAiPictures} = await import('../../services/utils/picture-choice.js');

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const quiet = () => ({log: jest.fn(), error: jest.fn()});
const picture = (name, width = 1200, source = 'site.example') => ({url: `https://${source}/${name}.jpg`, source, width, height: 675});
const card = (storyId, pictures, shown = pictures[0]?.url, changes = {}) => ({storyId, title: `Card ${storyId}`, thumbnail: shown, thumbnailSource: 'site.example', pictures, ...changes});

let loading;
beforeEach(() => {
    ollamaJson.mockReset();
    delete process.env.AI_PICTURES;
    loading = jest.fn(async (url) => String(url).includes('broken') ? new Response('gone', {status: 404}) : new Response(jpeg, {status: 200}));
    globalThis.fetch = loading;
});
afterEach(() => { delete process.env.AI_PICTURES; });

describe('candidatesOf', () => {
    it('should give the picture shown first, then the other pictures wide enough, four at most', () => {
        const item = card(1, [picture('a'), picture('b'), picture('narrow', 300), picture('c'), picture('d'), picture('e')], picture('c').url);
        expect(candidatesOf(item).map(one => one.url.split('/').pop())).toEqual(['c.jpg', 'a.jpg', 'b.jpg', 'd.jpg']);
        expect(candidatesOf(item)).toHaveLength(CANDIDATES);
    });

    it('should leave out a picture on http, which the page on https blocks', () => {
        const insecure = {url: 'http://old.example/a.jpg', source: 'old.example', width: 1200, height: 675};
        expect(candidatesOf(card(1, [picture('a'), insecure, picture('b')])).map(one => one.source)).toEqual(['site.example', 'site.example']);
    });

    it('should give none for a card with one picture only, or whose picture shown is no picture of its articles', () => {
        expect(candidatesOf(card(1, [picture('a')]))).toEqual([]);
        expect(candidatesOf(card(1, [picture('a'), picture('b')], 'https://commons.example/illustration.jpg'))).toEqual([]);
        expect(candidatesOf(card(1, [picture('a'), picture('narrow', 300)]))).toEqual([]);
        expect(candidatesOf({storyId: 1, title: 'No picture'})).toEqual([]);
    });
});

describe('normalizeAnswer', () => {
    it('should keep the ratings in their scale and the letter chosen', () => {
        expect(normalizeAnswer({ratings: {A: {q: 4, r: 2}, B: {q: '3', r: 1}}, best: 'b'}, ['A', 'B'])).toEqual({ratings: {A: {q: 4, r: 2}, B: {q: 3, r: 1}}, best: 'B'});
        expect(normalizeAnswer({ratings: {A: {q: 4, r: 2}}, best: ' B. '}, ['A', 'B']).best).toBe('B');
    });

    it('should drop a rating out of its scale, a letter that is none of the pictures, and the words around a letter', () => {
        const answer = normalizeAnswer({ratings: {A: {q: 9, r: 2}, B: {q: 3}, C: {q: 3, r: 1}, D: {q: 'good', r: 1}}, best: 'Picture B'}, ['A', 'B', 'C']);
        expect(answer).toEqual({ratings: {C: {q: 3, r: 1}}, best: null});
        expect(normalizeAnswer({ratings: {}, best: 'D'}, ['A', 'B']).best).toBeNull();
        for (const bad of [null, 'yes', [], {}, {ratings: 'none'}]) expect(normalizeAnswer(bad, ['A', 'B'])).toEqual({ratings: {}, best: null});
    });
});

describe('chooseLetter', () => {
    const rate = (a, b, best = 'B') => ({ratings: {A: {q: a[0], r: a[1]}, B: {q: b[0], r: b[1]}}, best});

    it('should keep the picture shown unless the other is better by one point of quality', () => {
        expect(chooseLetter(rate([4, 2], [5, 2]))).toBe('B');
        expect(chooseLetter(rate([3, 1], [4, 1]))).toBe('B');
        expect(chooseLetter(rate([4, 2], [4, 2]))).toBe('A');
        expect(chooseLetter(rate([5, 2], [4, 2]))).toBe('A');
        expect(chooseLetter(rate([4, 2], [5, 2], 'A'))).toBe('A');
    });

    it('should take another picture for one shown that is unrelated, when the other is not', () => {
        expect(chooseLetter(rate([5, 0], [3, 1]))).toBe('B');
        expect(chooseLetter(rate([5, 0], [3, 0]))).toBe('A');
    });

    it('should not take a sharper picture of another subject: its relevance counts for 3 points', () => {
        expect(chooseLetter(rate([3, 1], [5, 0]))).toBe('A');
        expect(chooseLetter(rate([2, 1], [5, 0]))).toBe('A');
        // only a picture shown that is very poor loses to a sharp one of another subject
        expect(chooseLetter(rate([1, 1], [5, 0]))).toBe('B');
    });

    it('should keep the picture shown when a rating or the choice is missing', () => {
        expect(chooseLetter({ratings: {B: {q: 5, r: 2}}, best: 'B'})).toBe('A');
        expect(chooseLetter({ratings: {A: {q: 2, r: 2}}, best: 'B'})).toBe('A');
        expect(chooseLetter({ratings: {A: {q: 2, r: 2}, B: {q: 5, r: 2}}, best: null})).toBe('A');
    });

    it('should work for the picture shown under another letter', () => {
        expect(chooseLetter({ratings: {A: {q: 5, r: 2}, B: {q: 3, r: 2}}, best: 'A'}, 'B')).toBe('A');
        expect(chooseLetter({ratings: {A: {q: 5, r: 2}, B: {q: 3, r: 2}}, best: 'B'}, 'B')).toBe('B');
    });
});

describe('wideForStanding', () => {
    const ratings = {A: {q: 4, r: 2}, B: {q: 4, r: 2}, C: {q: 5, r: 1}, D: {q: 2, r: 2}};

    it('should take the wide picture the AI chose when it is as good as the standing one shown', () => {
        expect(wideForStanding({ratings, best: 'B'}, 'A', ['B', 'C'])).toBe('B');
    });

    it('should take the best rated of the wide ones when the AI chose the standing one, the AI not choosing a wide one', () => {
        // C has a quality of 5 but a relevance below the one shown: B
        expect(wideForStanding({ratings, best: 'A'}, 'A', ['B', 'C', 'D'])).toBe('B');
        expect(wideForStanding({ratings: {...ratings, C: {q: 5, r: 2}}, best: 'A'}, 'A', ['B', 'C', 'D'])).toBe('C');
    });

    it('should keep the picture shown when no wide one is as good, relevant, or when it is wide itself or not rated', () => {
        expect(wideForStanding({ratings, best: 'A'}, 'A', ['D'])).toBe('A');
        expect(wideForStanding({ratings: {A: {q: 4, r: 2}, B: {q: 5, r: 0}}, best: 'A'}, 'A', ['B'])).toBe('A');
        expect(wideForStanding({ratings, best: 'A'}, 'A', ['A', 'B'])).toBe('A');
        expect(wideForStanding({ratings: {B: {q: 5, r: 2}}, best: 'B'}, 'A', ['B'])).toBe('A');
        expect(wideForStanding({ratings, best: 'A'}, 'A', [])).toBe('A');
    });
});

describe('choosePictures and a standing picture', () => {
    const standing = (name) => ({...picture(name), width: 800, height: 1200});
    // story 3, 3 pictures: the picture shown is the "A"
    const standingFirst = [card(3, [standing('shown'), picture('wide'), picture('third')])];
    const wideFirst = [card(3, [picture('shown'), standing('portrait'), picture('third')])];

    it('should put a wide picture in place of a standing one the AI finds as good', async () => {
        ollamaJson.mockResolvedValue({ratings: {A: {q: 4, r: 2}, B: {q: 4, r: 2}, C: {q: 3, r: 2}}, best: 'B'});
        const changes = await choosePictures(standingFirst, {log: quiet()});
        expect(changes.get(3)).toMatchObject({thumbnail: 'https://site.example/wide.jpg', from: 'https://site.example/shown.jpg'});
    });

    it('should put a wide picture in place of a standing one the AI chose, when a wide one is as good', async () => {
        ollamaJson.mockResolvedValue({ratings: {A: {q: 4, r: 2}, B: {q: 4, r: 2}, C: {q: 3, r: 2}}, best: 'A'});
        expect((await choosePictures(standingFirst, {log: quiet()})).get(3)).toMatchObject({thumbnail: 'https://site.example/wide.jpg'});
    });

    it('should keep a standing picture when the wide ones are worse or not relevant', async () => {
        ollamaJson.mockResolvedValue({ratings: {A: {q: 4, r: 2}, B: {q: 3, r: 2}, C: {q: 5, r: 0}}, best: 'A'});
        expect((await choosePictures(standingFirst, {log: quiet()})).size).toBe(0);
    });

    it('should not put a standing picture in place of a wide one for one point: it takes two', async () => {
        ollamaJson.mockResolvedValue({ratings: {A: {q: 3, r: 2}, B: {q: 4, r: 2}, C: {q: 3, r: 2}}, best: 'B'});
        expect((await choosePictures(wideFirst, {log: quiet()})).size).toBe(0);
        ollamaJson.mockResolvedValue({ratings: {A: {q: 2, r: 2}, B: {q: 4, r: 2}, C: {q: 3, r: 2}}, best: 'B'});
        expect((await choosePictures(wideFirst, {log: quiet()})).get(3)).toMatchObject({thumbnail: 'https://site.example/portrait.jpg'});
    });
});

describe('choicePrompt', () => {
    it('should give the news and the letters, and ask for the quality, the relevance and the best', () => {
        const prompt = choicePrompt('Wenger considers standing against Infantino', ['A', 'B', 'C']);
        expect(prompt).toContain('The news: "Wenger considers standing against Infantino"');
        expect(prompt).toContain('3 candidate pictures, in the order A, B, C');
        expect(prompt).toContain('"best"');
    });
});

describe('fetchPicture', () => {
    it('should give a picture as base64, read as it is', async () => {
        expect(await fetchPicture('https://site.example/a.jpg')).toEqual({data: jpeg.toString('base64'), bytes: jpeg.length});
        expect(loading.mock.calls[0][1].headers['User-Agent']).toContain('NewsGenerator');
    });

    it('should give null for an error, a page, a private address, and a file too large', async () => {
        expect(await fetchPicture('https://site.example/broken.jpg')).toBeNull();
        loading.mockResolvedValueOnce(new Response('<!doctype html><html></html>', {status: 200}));
        expect(await fetchPicture('https://site.example/page.jpg')).toBeNull();
        expect(await fetchPicture('http://private.example/a.jpg')).toBeNull();
        loading.mockResolvedValueOnce(new Response(jpeg, {status: 200, headers: {'content-length': String(10 * 1024 * 1024)}}));
        expect(await fetchPicture('https://site.example/huge.jpg')).toBeNull();
    });

    it('should give null, not throw, when the connection fails', async () => {
        loading.mockRejectedValueOnce(new TypeError('fetch failed'));
        expect(await fetchPicture('https://site.example/a.jpg')).toBeNull();
    });
});

describe('choosePictures', () => {
    // the shown picture is the first one: with the story 2 it is the "A" of the AI, with the story 1 the "B"
    const items = (storyId) => [card(storyId, [picture('shown'), picture('other'), picture('third')])];

    it('should change the picture when the AI finds another one better, showing the pictures in the order of their letters', async () => {
        ollamaJson.mockResolvedValue({ratings: {A: {q: 5, r: 2}, B: {q: 3, r: 2}, C: {q: 3, r: 2}}, best: 'A'});
        const usage = {calls: 0, input: 0, output: 0};
        const log = quiet();
        // story 1: letters B C A for shown, other, third: the best "A" is the third picture
        const changes = await choosePictures(items(1), {usage, label: 7, log});
        expect(changes.get(1)).toMatchObject({thumbnail: 'https://site.example/third.jpg', thumbnailSource: 'site.example', from: 'https://site.example/shown.jpg', scores: {shown: {q: 3, r: 2}, chosen: {q: 5, r: 2}}});
        const [prompt, , options] = ollamaJson.mock.calls[0];
        expect(prompt[0].content).toContain('The news: "Card 1"');
        expect(prompt[0].images).toHaveLength(3);
        expect(options).toMatchObject({model: 'gemma4:31b', fallback: null, think: false});
        expect(log.log.mock.calls.join('\n')).toContain('changed (quality 3 -> 5, relevance 2 -> 2)');
        expect(log.log.mock.calls.at(-1)[0]).toContain('1 changed');
    });

    it('should keep the letters turned by the story: the same answer is no change when the picture shown is the "A"', async () => {
        ollamaJson.mockResolvedValue({ratings: {A: {q: 5, r: 2}, B: {q: 3, r: 2}, C: {q: 3, r: 2}}, best: 'A'});
        // 3 pictures, story 3: turn 0, the picture shown is the A
        expect((await choosePictures(items(3), {log: quiet()})).size).toBe(0);
    });

    it('should leave the card as it is when the AI finds no picture better by a point', async () => {
        ollamaJson.mockResolvedValue({ratings: {A: {q: 4, r: 2}, B: {q: 4, r: 2}, C: {q: 4, r: 2}}, best: 'B'});
        expect((await choosePictures(items(1), {log: quiet()})).size).toBe(0);
    });

    it('should ask nothing for a card with no other picture, or none of its articles', async () => {
        await choosePictures([card(1, [picture('a')]), {storyId: 2, title: 'No picture'}], {log: quiet()});
        expect(ollamaJson).not.toHaveBeenCalled();
        expect(loading).not.toHaveBeenCalled();
    });

    it('should leave a card whose picture shown does not load, or with no other that loads, and not ask the AI about it', async () => {
        const log = quiet();
        const changes = await choosePictures([
            card(1, [picture('broken'), picture('other')]),
            card(2, [picture('shown'), picture('broken2')]),
        ], {log});
        expect(changes.size).toBe(0);
        expect(ollamaJson).not.toHaveBeenCalled();
        expect(log.log.mock.calls.at(-1)[0]).toContain('2 left as they were');
    });

    it('should show the AI the pictures that load only, and change nothing when its choice is out of them', async () => {
        ollamaJson.mockResolvedValue({ratings: {A: {q: 5, r: 2}, B: {q: 1, r: 2}}, best: 'C'});
        const changes = await choosePictures([card(2, [picture('shown'), picture('broken'), picture('other')])], {log: quiet()});
        expect(ollamaJson.mock.calls[0][0][0].images).toHaveLength(2);
        expect(changes.size).toBe(0);
    });

    it('should leave the cards when the AI does not answer, answers what cannot be read, or the switch is off', async () => {
        const log = quiet();
        ollamaJson.mockRejectedValue(new Error('Ollama: no answer'));
        expect((await choosePictures(items(1), {log})).size).toBe(0);
        expect(ollamaJson).toHaveBeenCalledTimes(2);
        expect(log.error.mock.calls.join('\n')).toContain('was not looked at');
        ollamaJson.mockReset();
        ollamaJson.mockResolvedValue({unexpected: true});
        expect((await choosePictures(items(1), {log: quiet()})).size).toBe(0);
        ollamaJson.mockReset();
        process.env.AI_PICTURES = 'off';
        expect((await choosePictures(items(1), {log: quiet()})).size).toBe(0);
        expect(ollamaJson).not.toHaveBeenCalled();
    });

    it('should count the tokens given and leave the list of cards alone', async () => {
        ollamaJson.mockResolvedValue({ratings: {}, best: null});
        const list = items(1);
        const before = JSON.stringify(list);
        await choosePictures(list, {usage: {calls: 0, input: 0, output: 0}, log: quiet()});
        expect(JSON.stringify(list)).toBe(before);
    });
});

describe('withAiPictures', () => {
    const items = [card(1, [picture('a'), picture('b')]), card(2, [picture('c'), picture('d')])];

    it('should give the picture chosen to its card, with what it replaced, the other cards the same ones', () => {
        const changes = new Map([[2, {thumbnail: 'https://other.example/d.jpg', thumbnailSource: 'other.example', from: 'https://site.example/c.jpg', fromSource: 'site.example', scores: {shown: {q: 2, r: 1}, chosen: {q: 4, r: 1}}}]]);
        const result = withAiPictures(items, changes);
        expect(result[0]).toBe(items[0]);
        expect(result[1]).toMatchObject({thumbnail: 'https://other.example/d.jpg', thumbnailSource: 'other.example', pictureChosen: {from: 'https://site.example/c.jpg', fromSource: 'site.example', scores: {shown: {q: 2, r: 1}, chosen: {q: 4, r: 1}}}});
        expect(result[1].pictures).toBe(items[1].pictures);
    });

    it('should give the same list when nothing changed', () => {
        expect(withAiPictures(items, new Map())).toBe(items);
    });
});
