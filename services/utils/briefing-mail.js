//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: briefing-mail.js
//  Description: The cards of a briefing the reader ticked as an e-mail, laid out as the page shows them
//               (client BriefingCard.jsx): number, topic, date and language, title, why, picture, its
//               sentences in the way the reader chose (bullet points, summary or key passages), who
//               denies it, its other angles, where to read it, and the notes of its margin (its
//               official source first). Who tells it is left out: its sources say it already
//

"use strict"

import {languageName} from './language.js';

// The colours and fonts of the page (client styles/index.css). Mail apps keep inline styles and simple
// tables only; the fonts of the page are asked from Google Fonts, which Apple Mail and Outlook for Mac
// load and Gmail replaces by Georgia. The dark colours apply where the mail app follows the system
const LIGHT = {paper: '#FBF9F4', ink: '#1A1815', mute: '#6B655C', rule: '#DAD3C7', accent: '#A6301F', secondary: '#F3EFE6'};
const DARK = {paper: '#17150F', ink: '#ECE7DC', mute: '#9A9384', rule: '#35312A', accent: '#E0654F', secondary: '#221F18'};
const DISPLAY = "Fraunces, Georgia, 'Times New Roman', serif";
const TEXT = "'Source Serif 4', Georgia, 'Times New Roman', serif";
const MONO = 'ui-monospace, Menlo, Consolas, monospace';
const FONTS = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..600&family=Source+Serif+4:ital,opsz,wght@0,8..60,400..600;1,8..60,400&display=swap';

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[char]);
// an address of the web only: a link or a picture never runs anything
const webUrl = (url) => /^https?:\/\//i.test(String(url ?? '')) ? String(url) : null;
const when = (iso) => iso ? new Date(iso).toLocaleString('en-GB', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich'}) : '';
const day = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Zurich'}) : '';
const paragraphsOf = (text) => String(text ?? '').split(/\n\s*\n/).map(paragraph => paragraph.trim()).filter(Boolean);

// The ways the sentences of a card can be sent in, as the page shows them (client formats.js): the 3
// most important ones as bullet points, the ones of 5 to 6 lines as one paragraph, the key passages. A
// card of a briefing written before the first two (12.10.2026) has its key passages only
export const MAIL_FORMATS = ['points', 'digest', 'passages'];
const WAYS = {
    points: {text: 'points', translation: 'pointsTranslation', title: 'Key points'},
    digest: {text: 'digest', translation: 'digestTranslation', title: 'Summary'},
    passages: {text: 'summary', translation: 'translation', title: 'Key passages'},
};
// {paragraphs, title, way, translated}: the sentences of the card in the way asked, their translation
// when the article is written in another language than the reader's
const wayOf = (card, format) => {
    const way = format === 'points' && card.points ? 'points' : format === 'digest' && card.digest ? 'digest' : 'passages';
    const {text, translation, title} = WAYS[way];
    return {paragraphs: paragraphsOf(card[translation] || card[text]), title, way, translated: Boolean(card[translation])};
};

// the text styles of the page (kicker, caption, body-text, link); the classes ng-* take the dark colours
const KICKER = `font:600 14px/1.2 ${TEXT};font-variant:all-small-caps;letter-spacing:.1em;color:${LIGHT.mute};margin:0`;
const CAPTION = `font:13px/1.4 ${TEXT};letter-spacing:.01em;color:${LIGHT.mute};margin:0`;
const BODY = `font:17px/1.6 ${TEXT};color:${LIGHT.ink};margin:0`;
const LINK = `color:${LIGHT.accent};text-decoration:underline;text-underline-offset:4px`;
const DARK_STYLE = `
:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme: dark){
  .ng-paper{background:${DARK.paper}!important}
  .ng-ink{color:${DARK.ink}!important}
  .ng-mute{color:${DARK.mute}!important}
  .ng-accent{color:${DARK.accent}!important}
  .ng-rule{border-color:${DARK.rule}!important}
  .ng-box{border-color:${DARK.rule}!important;color:${DARK.mute}!important}
}`;

// the language a source writes in, next to its name (client LanguageMark.jsx)
const languageMark = (code) => code
    ? ` <span class="ng-box" title="Written in ${escape(languageName(code))}" style="display:inline-block;border:1px solid ${LIGHT.rule};padding:0 4px;font:500 11px/1.35 ${MONO};letter-spacing:.04em;color:${LIGHT.mute};text-transform:uppercase;vertical-align:1px">${escape(code)}</span>`
    : '';
const kicker = (text, tone = 'mute') => `<p class="ng-${tone}" style="${KICKER}${tone === 'accent' ? `;color:${LIGHT.accent}` : ''}">${escape(text)}</p>`;

// the passages, "[…]" between two of them; the first letter of the first card large, as on the page
const passagesHtml = (paragraphs, lede) => paragraphs.map((paragraph, i) => {
    const gap = i > 0 ? `<p class="ng-mute" style="${BODY};color:${LIGHT.mute};margin:12px 0">[…]</p>` : '';
    const dropCap = lede && i === 0 && paragraph.length > 1;
    const text = dropCap
        ? `<span class="ng-accent" style="float:left;font:500 66px/0.8 ${DISPLAY};color:${LIGHT.accent};margin:6px 8px 0 0">${escape(paragraph[0])}</span>${escape(paragraph.slice(1))}`
        : escape(paragraph);
    return `${gap}<p class="ng-ink" style="${BODY}">${text}</p>`;
}).join('');

// the summary: the same in one paragraph, the gaps marked inside it
const digestHtml = (paragraphs, lede) => passagesHtml([paragraphs.join(' […] ')], lede);

// the bullet points, a sentence each, the most important first
const pointsHtml = (paragraphs) => `<ul style="margin:0;padding-left:22px">${paragraphs
    .map(paragraph => `<li class="ng-ink" style="${BODY};margin-top:8px">${escape(paragraph)}</li>`).join('')}</ul>`;
const WAYS_HTML = {points: pointsHtml, digest: digestHtml, passages: passagesHtml};

// the same in the text of the e-mail
const wayText = ({paragraphs, way}) => way === 'points'
    ? paragraphs.map(paragraph => `• ${paragraph}`).join('\n')
    : paragraphs.join(way === 'digest' ? ' […] ' : '\n[…]\n');

const contestedHtml = (denials) => denials.length === 0 ? '' : `
<div class="ng-rule" style="margin-top:24px;border-left:2px solid ${LIGHT.accent};padding-left:18px">
  ${kicker('Contested', 'accent')}
  ${denials.map(denial => `
  <p class="ng-ink" style="${BODY};margin-top:12px"><b>${escape(denial.by)} denies:</b> “${escape(denial.sentence)}”</p>
  ${denial.translation ? `<p class="ng-mute" style="${CAPTION};margin-top:4px;font-style:italic">Machine translation: “${escape(denial.translation)}”</p>` : ''}
  <p class="ng-mute" style="${CAPTION};margin-top:4px">— ${webUrl(denial.url) ? `<a href="${escape(denial.url)}" class="ng-mute" style="color:${LIGHT.mute}">${escape(denial.source)}</a>` : escape(denial.source)}${denial.publishedAt ? `, ${escape(when(denial.publishedAt))}` : ''}</p>`).join('')}
</div>`;

// none left (the reader took them out, or none has a web address): no title either
const anglesHtml = (given) => {
    const angles = given.filter(angle => webUrl(angle.url));
    return angles.length === 0 ? '' : `
<div class="ng-rule" style="margin-top:28px;border-left:2px solid ${LIGHT.rule};padding-left:18px">
  ${kicker('Same affair, other angles')}
  ${angles.map(angle => `
  <p style="margin:12px 0 0"><a href="${escape(angle.url)}" class="ng-ink" style="font:600 17px/1.45 ${TEXT};color:${LIGHT.ink};text-decoration:none">${escape(angle.titleTranslation ?? angle.title)}</a></p>
  <p class="ng-mute" style="${CAPTION};margin-top:4px">${escape(angle.source)}${languageMark(angle.language)}${angle.publishedAt ? ` · ${escape(when(angle.publishedAt))}` : ''}${angle.media > 1 ? ` · told by ${angle.media} media` : ''}</p>`).join('')}
</div>`;
};

// where to read it (client NewsLinks.jsx): the article of the passages, then each other medium once
const SHOWN_OTHERS = 8;
const linksHtml = (card) => {
    const lead = card.lead ?? card.articles?.[0];
    if (!lead || !webUrl(lead.url)) return '';
    const seen = new Set([lead.source]);
    const others = (card.articles ?? []).filter(other => webUrl(other.url) && !seen.has(other.source) && seen.add(other.source));
    return `
<p style="margin:28px 0 0;font:16px/1.4 ${TEXT}"><a href="${escape(lead.url)}" class="ng-accent" style="${LINK}">Read the article at ${escape(lead.source)}</a>${lead.trusted ? ` <span class="ng-accent" style="color:${LIGHT.accent}">★</span>` : ''}${languageMark(lead.language)}</p>
${others.length > 0 ? `<p class="ng-mute" style="${CAPTION};margin-top:8px">Also covered by ${others.slice(0, SHOWN_OTHERS)
        .map(other => `<a href="${escape(other.url)}" class="ng-mute" style="color:${LIGHT.mute};text-decoration:underline;text-decoration-color:${LIGHT.rule}">${escape(other.source)}</a>${other.trusted ? ' ★' : ''}${languageMark(other.language)}`)
        .join(', ')}${others.length > SHOWN_OTHERS ? ` and ${others.length - SHOWN_OTHERS} more` : ''}</p>` : ''}`;
};

// the posts where a party said the news itself (see official-sources.js), a line each: none left (the
// reader took them out, or none has a web address), no note
const officialHtml = (given) => given.filter(post => webUrl(post.url))
    .map(post => `<b>${escape(post.party)}</b> said it: <a href="${escape(post.url)}" class="ng-ink" style="color:${LIGHT.ink};text-decoration:underline;text-decoration-color:${LIGHT.rule}">${escape(post.title)}</a>${post.publishedAt ? `, ${escape(when(post.publishedAt))}` : ''}`)
    .join('<br>') || null;

// the notes of the outer column of the page, under the card in the e-mail; html: the note is written
// already, else its text is escaped
const notesHtml = (card) => {
    const notes = [
        ['Official source', officialHtml(card.official ?? []), 'mute', true],
        ['Not confirmed', card.hedged ? `unconfirmed: “${card.hedged}”` : null, 'accent'],
    ].filter(([, text]) => text);
    if (notes.length === 0) return '';
    // one under the other: side by side they left a phone a few words a line
    return `
<div class="ng-rule" style="margin-top:24px;border-top:1px solid ${LIGHT.rule}">
  ${notes.map(([title, text, tone, html]) => `<div style="padding-top:12px">${kicker(title, tone)}<p class="ng-ink" style="${CAPTION};color:${LIGHT.ink};margin-top:4px">${html ? text : escape(text)}</p></div>`).join('')}
</div>`;
};

// the title shown: the one the reader wrote for the e-mail (ownTitle), else the translated one
const titleOf = (card) => card.ownTitle ?? card.titleTranslation ?? card.title;

// personal: the why of the card, written to the reader ("that you follow"), left out of an e-mail to
// another; format: the way its sentences are shown (see wayOf)
const cardHtml = (card, i, personal = true, format = 'passages') => {
    const sentences = wayOf(card, format);
    const translated = Boolean(card.titleTranslation) || sentences.translated;
    // or a file of the reader joined to the e-mail (see mail-pictures.js)
    const picture = webUrl(card.thumbnail) ?? (/^cid:[\w.@-]+$/.test(card.thumbnail ?? '') ? card.thumbnail : null);
    return `
<tr><td class="ng-rule" style="border-top:1px solid ${LIGHT.rule};padding:26px 0 44px">
  <!-- the number, topic, date and language above the title, not in a column of their own as on the
       page: on a phone the text keeps the whole width -->
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:14px"><tr>
    <td valign="bottom" style="padding-right:14px"><p class="ng-mute" style="margin:0;font:400 46px/1 ${DISPLAY};color:${LIGHT.mute}">${String(i + 1).padStart(2, '0')}</p></td>
    <td valign="bottom" style="padding-bottom:4px"><p class="ng-mute" style="${CAPTION};font-weight:500">${[
        card.topic ? `<span class="ng-ink" style="${KICKER};color:${LIGHT.ink}">${escape(card.topic)}</span>` : '',
        card.publishedAt ? escape(when(card.publishedAt)) : '',
        card.language ? languageMark(card.language).trim() : '',
    ].filter(Boolean).join(' · ')}</p></td>
  </tr></table>
  <h2 class="ng-ink" style="margin:0;font:460 27px/1.12 ${DISPLAY};letter-spacing:-.005em;color:${LIGHT.ink}">${escape(titleOf(card))}</h2>
  ${translated ? `<p style="margin:8px 0 0">${kicker(`Translated from ${languageName(card.language ?? '')}`)}</p>` : ''}
  ${card.titleTranslation && !card.ownTitle ? `<p class="ng-mute" style="${CAPTION};margin-top:4px;font-style:italic">“${escape(card.title)}”</p>` : ''}
  ${personal && card.why ? `<p class="ng-mute" style="margin:12px 0 0;font:italic 19px/1.4 ${TEXT};color:${LIGHT.mute}">${escape(card.why)}</p>` : ''}
  ${picture ? `<img src="${escape(picture)}" alt="" width="560" style="display:block;width:100%;max-width:560px;height:auto;margin-top:20px;border:0;background:${LIGHT.secondary}">
  ${card.thumbnailSource ? `<p class="ng-mute" style="${CAPTION};margin-top:6px">Picture — ${escape(card.thumbnailSource)}</p>` : ''}` : ''}
  ${sentences.paragraphs.length > 0 ? `
  <div style="margin-top:24px">${kicker(sentences.title)}</div>
  <div style="margin-top:12px;overflow:hidden">${WAYS_HTML[sentences.way](sentences.paragraphs, i === 0)}</div>` : ''}
  ${contestedHtml(card.contested ?? [])}
  ${anglesHtml(card.angles ?? [])}
  ${linksHtml(card)}
  ${notesHtml(card)}
</td></tr>`;
};

// briefing: as toBriefing gives it, its items the cards the reader ticked (ownTitle: a title they wrote
// for the e-mail); profile: the name of the profile it was written for, in its title and subject (the
// user, 13.10.2026: the name of the profile, never the one of the account); sender: the username of the
// reader when it is sent to another address than theirs (the reasons the cards were chosen for them are
// left out then, who sends it is in its Reply-To); format: the way the sentences of the cards are shown,
// one of MAIL_FORMATS. The day only, no hour, in its subject and under its title. {subject, html, text}
export const briefingMail = (briefing, {profile = null, sender = null, format = 'passages'} = {}) => {
    const cards = briefing.items ?? [];
    const finished = briefing.finishedAt ?? briefing.createdAt;
    const count = `${cards.length} ${cards.length === 1 ? 'story' : 'stories'}`;
    // "Roberto’s Briefing · 13 October 2026"
    const name = profile ? `${profile}’s Briefing` : 'Briefing';
    const title = `${name} · ${day(finished)}`;
    const subject = `${name} · ${count} · ${day(finished)}`;

    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<link rel="stylesheet" href="${FONTS}"><style>${DARK_STYLE}</style><title>${escape(subject)}</title></head>
<body class="ng-paper" style="margin:0;padding:0;background:${LIGHT.paper}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="ng-paper" style="background:${LIGHT.paper}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;text-align:left">
<tr><td style="padding-bottom:28px">
  <h1 class="ng-ink" style="margin:0;font:460 40px/1.05 ${DISPLAY};color:${LIGHT.ink}">${escape(title)}</h1>
  <p class="ng-mute" style="${CAPTION};font-weight:500;margin-top:14px">${count} shared</p>
</td></tr>
${cards.map((card, i) => cardHtml(card, i, !sender, format)).join('')}
</table></td></tr></table></body></html>`;

    const text = [
        `${title}\n`,
        ...cards.map((card, i) => {
            const lead = card.lead ?? card.articles?.[0];
            return [
                `${String(i + 1).padStart(2, '0')}. ${titleOf(card)}`,
                sender ? '' : card.why ?? '',
                '',
                wayText(wayOf(card, format)),
                ...(card.contested ?? []).map(denial => `Contested — ${denial.by} denies: "${denial.sentence}" (${denial.source})`),
                ...(card.angles ?? []).map(angle => `Other angle: ${angle.titleTranslation ?? angle.title} (${angle.source}) ${angle.url}`),
                ...(card.official ?? []).map(post => `Official source — ${post.party} said it: ${post.title} ${post.url}`),
                lead ? `Read the article at ${lead.source}: ${lead.url}` : '',
                '',
            ].filter((line, j, lines) => line !== '' || lines[j - 1] !== '').join('\n');
        }),
    ].join('\n');

    return {subject, html, text};
};
