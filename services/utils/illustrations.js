//
//  Author: Fabian Rostello
//  Date: 18.10.2026
//  File: illustrations.js
//  Description: The illustration of a card: the picture Wikimedia Commons has of the person, else of the
//               organisation, most of its articles name (see card-names.js). Never the picture of the
//               news: shown as an illustration, credited to its author and its licence, and only where
//               no article of the story gives a picture of its own (the user, 18.10.2026)
//

"use strict"

import {readPictures} from './wikidata.js';

// Measured on 200 cards of 12 briefings (18.10.2026): 102 name someone Wikidata knows, 92 of them have a
// picture there, 86 one of 560 px or more. A person is the one of the news (Infantino, Wenger, Motsepe);
// an organisation is its building (the seat of UEFA in Nyon, the Googleplex), shown after a person
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const HEADERS = {'User-Agent': 'NewsGenerator/1.0 (self-hosted news reader)', Accept: 'application/json'};
const TIMEOUT_MS = 15000;
const FILES_PER_CALL = 40;
// the width asked, one Wikimedia keeps ready (1200 is served at 1280 anyway); the e-mail shows 560
const WIDTH = 1280;
export const MIN_WIDTH = 560;
// photographs only: a drawing, a map or a coat of arms (.svg) tells nothing of the news
const PHOTO = /\.(?:jpe?g|png|webp|tiff?)$/i;
const KINDS = ['person', 'organization'];
const MAX_CREDIT = 80;

const plain = (html) => String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// Map file name -> {url, width, height, page, credit} of these files of Commons, the ones it has
const readFiles = async (files) => {
    const found = new Map();
    for (let i = 0; i < files.length; i += FILES_PER_CALL) {
        const part = files.slice(i, i + FILES_PER_CALL);
        const params = new URLSearchParams({action: 'query', titles: part.map(file => `File:${file}`).join('|'), prop: 'imageinfo',
            iiprop: 'url|size|extmetadata', iiurlwidth: String(WIDTH), iiextmetadatafilter: 'Artist|LicenseShortName', format: 'json'});
        const res = await fetch(`${COMMONS}?${params}`, {headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS)});
        if (!res.ok) throw new Error(`Wikimedia Commons answered ${res.status}.`);
        const answer = await res.json();
        // the titles as asked ("File:A b.jpg") and as answered once normalized ("File:A_b.jpg")
        const asked = new Map((answer.query?.normalized ?? []).map(name => [name.to, name.from]));
        for (const page of Object.values(answer.query?.pages ?? {})) {
            const info = page.imageinfo?.[0];
            if (!info?.thumburl || !/^https:\/\//.test(info.thumburl)) continue;
            const artist = plain(info.extmetadata?.Artist?.value).slice(0, MAX_CREDIT);
            const license = plain(info.extmetadata?.LicenseShortName?.value);
            found.set((asked.get(page.title) ?? page.title).replace(/^File:/, ''), {
                url: info.thumburl,
                width: info.width,
                height: info.height,
                page: info.descriptionurl ?? null,
                credit: ['Wikimedia Commons', [artist, license].filter(Boolean).join(', ')].filter(Boolean).join(' · '),
            });
        }
    }
    return found;
};

// The illustrations of cards: namesByCard Map storyId -> [{name, qid, kind}] (see namesOfCards), the most
// named first. Answers Map storyId -> {url, width, height, page, credit, name}: the first person with a
// photograph of MIN_WIDTH px or more, else the first organisation; a card without one left out
export const illustrationsOf = async (namesByCard) => {
    const named = [...namesByCard.values()].flat().filter(name => name.qid && KINDS.includes(name.kind));
    if (named.length === 0) return new Map();
    const fileOf = await readPictures(named.map(name => name.qid));
    const files = [...new Set([...fileOf.values()].filter(file => PHOTO.test(file)))];
    const pictures = files.length === 0 ? new Map() : await readFiles(files);
    const pictureOf = (name) => {
        const picture = pictures.get(fileOf.get(name.qid));
        return picture && picture.width >= MIN_WIDTH ? {...picture, name: name.name} : null;
    };
    const found = new Map();
    for (const [storyId, names] of namesByCard) {
        for (const kind of KINDS) {
            const picture = names.filter(name => name.kind === kind).map(pictureOf).find(Boolean);
            if (picture) {
                found.set(storyId, picture);
                break;
            }
        }
    }
    return found;
};
