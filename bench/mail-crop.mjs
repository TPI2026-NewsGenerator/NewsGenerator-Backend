// The e-mail with a standing picture, a wide one and a near-square one, to look at in a browser (friend's point 5, 10.11.2026): node bench/mail-crop.mjs <out.html>
import process from 'node:process';
import {writeFileSync} from 'node:fs';
import {briefingMail} from '../services/utils/briefing-mail.js';

const out = process.argv[2] ?? 'bench/data/mail-crop.html';
const THUMB = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2c/Gianni_Infantino_Argentina_v_Spain_19_July_2026-278.jpg/1280px-Gianni_Infantino_Argentina_v_Spain_19_July_2026-278.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail';
const WIDE = 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/640px-PNG_transparency_demonstration_1.png';
const card = (storyId, title, thumbnail, size) => ({storyId, title, summary: 'A passage of the news, as published.', thumbnail, thumbnailSource: 'media.example', publishedAt: '2026-11-10T08:00:00Z',
    language: 'en', pictures: [{url: thumbnail, source: 'media.example', ...size}]});
const {html} = briefingMail({items: [
    card(1, 'A standing picture (2:3), cut to a landscape', THUMB, {width: 1280, height: 1920}),
    card(2, 'A wide picture, as it was', WIDE, {width: 1600, height: 900}),
    card(3, 'A standing picture of unknown size, as it was', THUMB, {}),
]});
writeFileSync(out, html);
console.log(`${html.length} characters -> ${out}`);
