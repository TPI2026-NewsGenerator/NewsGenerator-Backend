//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: mail-pictures.js
//  Description: The picture of each card of an e-mail as the reader chose it before sending: taken
//               out, another of the story or of the web, or a file of theirs joined to the e-mail
//

"use strict"

import {Buffer} from "node:buffer";
import {assertPublicUrl, hostOf} from "./public-url.js";

export const MAX_PICTURE_BYTES = 2 * 1024 * 1024;       // a file of the reader, once decoded
export const MAX_PICTURES_BYTES = 6 * 1024 * 1024;      // all the files of one e-mail
const MAX_PICTURE_URL = 2000;

// the type of a file told by its first bytes, never by what the client says it is
const TYPES = [
    {type: 'image/jpeg', ext: 'jpg', is: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff},
    {type: 'image/png', ext: 'png', is: (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))},
    {type: 'image/gif', ext: 'gif', is: (bytes) => bytes.subarray(0, 4).toString('latin1') === 'GIF8'},
    {type: 'image/webp', ext: 'webp', is: (bytes) => bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP'},
];

const refuse = (message) => Object.assign(new Error(message), {status: 400});

// pictures: {storyId: null | {url} | {data}}, from the client: null takes the picture out, url puts
// an image of the web (one of the story, or one the reader pasted: the mail client of the receiver
// loads it, never this server), data a file of the reader in base64, joined to the e-mail and shown
// from it (cid:). A card not named keeps its own. items: the cards sent; sender: who chose them;
// known: url -> medium of the pictures of the stories (see storyPictures), credited to it.
// {items, attachments}: the cards with their picture, the files to join
export const withChosenPictures = async (items, pictures, {sender = null, known = new Map()} = {}) => {
    if (pictures === undefined || pictures === null) return {items, attachments: []};
    if (typeof pictures !== 'object' || Array.isArray(pictures)) throw refuse('pictures: {storyId: null, {url} or {data}}.');

    const attachments = [];
    let bytes = 0;
    const chosen = new Map();
    for (const item of items) {
        if (!Object.hasOwn(pictures, String(item.storyId))) continue;
        const choice = pictures[String(item.storyId)];

        if (choice === null) {
            chosen.set(item.storyId, {thumbnail: null, thumbnailSource: null});
        } else if (typeof choice?.url === 'string') {
            if (choice.url.length > MAX_PICTURE_URL || !/^https?:\/\//i.test(choice.url)) throw refuse('The address of a picture starts with https://.');
            // not the address of a machine of a private network, though only the receiver loads it
            await assertPublicUrl(choice.url).catch(() => { throw refuse('This address of a picture is not on the web.'); });
            chosen.set(item.storyId, {thumbnail: choice.url, thumbnailSource: known.get(choice.url) ?? hostOf(choice.url)});
        } else if (typeof choice?.data === 'string') {
            const file = Buffer.from(choice.data, 'base64');
            const type = TYPES.find(known => known.is(file));
            if (!type) throw refuse('A picture is a JPEG, PNG, GIF or WebP file.');
            if (file.length > MAX_PICTURE_BYTES) throw refuse(`A picture weighs ${MAX_PICTURE_BYTES / 1024 / 1024} MB at most.`);
            bytes += file.length;
            if (bytes > MAX_PICTURES_BYTES) throw refuse(`The pictures of an e-mail weigh ${MAX_PICTURES_BYTES / 1024 / 1024} MB at most.`);
            const cid = `picture-${item.storyId}@newsgenerator`;
            attachments.push({filename: `picture-${item.storyId}.${type.ext}`, content: file, contentType: type.type, cid});
            chosen.set(item.storyId, {thumbnail: `cid:${cid}`, thumbnailSource: sender ? `added by ${sender}` : 'added by you'});
        } else {
            throw refuse('pictures: {storyId: null, {url} or {data}}.');
        }
    }
    return {items: items.map(item => chosen.has(item.storyId) ? {...item, ...chosen.get(item.storyId)} : item), attachments};
};

// the html of an e-mail with its joined files written in it (data:), for the copy kept as it was sent:
// a page has no joined files to show by their cid
export const withPicturesWritten = (html, attachments) => attachments.reduce(
    (written, file) => written.replaceAll(`cid:${file.cid}`, `data:${file.contentType};base64,${file.content.toString('base64')}`), html);

// the pictures of a story the reader can choose among: the one of its card first, then the ones the
// feeds gave its articles. rows: [{link, thumbnail}] of its articles
export const storyPictures = (item, rows) => {
    const sources = new Map([item.lead, ...(item.articles ?? [])].filter(Boolean).map(article => [article.url, article.source]));
    const pictures = [];
    const seen = new Set();
    const add = (url, source) => {
        if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) return;
        seen.add(url);
        pictures.push({url, source: source ?? hostOf(url)});
    };
    add(item.thumbnail, item.thumbnailSource);
    for (const row of rows) add(row.thumbnail, sources.get(row.link) ?? hostOf(row.link));
    return pictures;
};
