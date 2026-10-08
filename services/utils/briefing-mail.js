//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: briefing-mail.js
//  Description: The cards of a briefing the reader ticked as an e-mail, laid out as the page shows them
//               (client BriefingCard.jsx): number, topic, date and language, title, why, picture, key
//               passages, who denies it, its other angles, where to read it, and the notes of its margin
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
const written = (iso) => iso ? new Date(iso).toLocaleString('en-GB', {weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich'}) : '';
const paragraphsOf = (text) => String(text ?? '').split(/\n\s*\n/).map(paragraph => paragraph.trim()).filter(Boolean);

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

// who tells it, as the page says it (client corroboration.js, coverageLabel of the texts read)
const coverageOf = ({media, read, independent, agencies = []} = {}) => {
    if (!media) return null;
    const wire = agencies.length > 0 ? ` · wire: ${agencies.join(', ')}` : '';
    if (media <= 1) return `Only one medium${wire}`;
    const told = `Told by ${media} media`;
    if (read < 2) return `${told}, too few texts could be read to compare them${wire}`;
    if (independent <= 1) return `${told}, one single text republished${wire}`;
    return `${told}, ${independent} texts written independently of ${read} read${wire}`;
};
const SOURCING = {named: 'named sources', anonymous: 'unnamed sources', none: 'no source given'};

// the passages, "[…]" between two of them; the first letter of the first card large, as on the page
const passagesHtml = (paragraphs, lede) => paragraphs.map((paragraph, i) => {
    const gap = i > 0 ? `<p class="ng-mute" style="${BODY};color:${LIGHT.mute};margin:12px 0">[…]</p>` : '';
    const dropCap = lede && i === 0 && paragraph.length > 1;
    const text = dropCap
        ? `<span class="ng-accent" style="float:left;font:500 66px/0.8 ${DISPLAY};color:${LIGHT.accent};margin:6px 8px 0 0">${escape(paragraph[0])}</span>${escape(paragraph.slice(1))}`
        : escape(paragraph);
    return `${gap}<p class="ng-ink" style="${BODY}">${text}</p>`;
}).join('');

const contestedHtml = (denials) => denials.length === 0 ? '' : `
<div class="ng-rule" style="margin-top:24px;border-left:2px solid ${LIGHT.accent};padding-left:18px">
  ${kicker('Contested', 'accent')}
  ${denials.map(denial => `
  <p class="ng-ink" style="${BODY};margin-top:12px"><b>${escape(denial.by)} denies:</b> “${escape(denial.sentence)}”</p>
  ${denial.translation ? `<p class="ng-mute" style="${CAPTION};margin-top:4px;font-style:italic">Machine translation: “${escape(denial.translation)}”</p>` : ''}
  <p class="ng-mute" style="${CAPTION};margin-top:4px">— ${webUrl(denial.url) ? `<a href="${escape(denial.url)}" class="ng-mute" style="color:${LIGHT.mute}">${escape(denial.source)}</a>` : escape(denial.source)}${denial.publishedAt ? `, ${escape(when(denial.publishedAt))}` : ''}</p>`).join('')}
</div>`;

const anglesHtml = (angles) => angles.length === 0 ? '' : `
<div class="ng-rule" style="margin-top:28px;border-left:2px solid ${LIGHT.rule};padding-left:18px">
  ${kicker('Same affair, other angles')}
  ${angles.filter(angle => webUrl(angle.url)).map(angle => `
  <p style="margin:12px 0 0"><a href="${escape(angle.url)}" class="ng-ink" style="font:600 17px/1.45 ${TEXT};color:${LIGHT.ink};text-decoration:none">${escape(angle.titleTranslation ?? angle.title)}</a></p>
  <p class="ng-mute" style="${CAPTION};margin-top:4px">${escape(angle.source)}${languageMark(angle.language)}${angle.publishedAt ? ` · ${escape(when(angle.publishedAt))}` : ''}${angle.media > 1 ? ` · told by ${angle.media} media` : ''}</p>`).join('')}
</div>`;

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

// the notes of the outer column of the page, under the card in the e-mail
const notesHtml = (card) => {
    const notes = [
        ['Who tells it', coverageOf(card.corroboration), 'mute'],
        ['Its sources', SOURCING[card.sourcing], 'mute'],
        ['Not confirmed', card.hedged ? `unconfirmed: “${card.hedged}”` : null, 'accent'],
    ].filter(([, text]) => text);
    if (notes.length === 0) return '';
    // one under the other: side by side they left a phone a few words a line
    return `
<div class="ng-rule" style="margin-top:24px;border-top:1px solid ${LIGHT.rule}">
  ${notes.map(([title, text, tone]) => `<div style="padding-top:12px">${kicker(title, tone)}<p class="ng-ink" style="${CAPTION};color:${LIGHT.ink};margin-top:4px">${escape(text)}</p></div>`).join('')}
</div>`;
};

// personal: the why of the card, written to the reader ("that you follow"), left out of an e-mail to another
const cardHtml = (card, i, personal = true) => {
    const passages = paragraphsOf(card.translation || card.summary);
    const translated = Boolean(card.titleTranslation) || Boolean(card.translation);
    const lead = card.lead ?? card.articles?.[0];
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
  <h2 class="ng-ink" style="margin:0;font:460 27px/1.12 ${DISPLAY};letter-spacing:-.005em;color:${LIGHT.ink}">${escape(card.titleTranslation ?? card.title)}</h2>
  ${translated ? `<p style="margin:8px 0 0">${kicker(`Translated from ${languageName(card.language ?? '')}`)}</p>` : ''}
  ${card.titleTranslation ? `<p class="ng-mute" style="${CAPTION};margin-top:4px;font-style:italic">“${escape(card.title)}”</p>` : ''}
  ${personal && card.why ? `<p class="ng-mute" style="margin:12px 0 0;font:italic 19px/1.4 ${TEXT};color:${LIGHT.mute}">${escape(card.why)}</p>` : ''}
  ${picture ? `<img src="${escape(picture)}" alt="" width="560" style="display:block;width:100%;max-width:560px;height:auto;margin-top:20px;border:0;background:${LIGHT.secondary}">
  ${card.thumbnailSource ? `<p class="ng-mute" style="${CAPTION};margin-top:6px">Picture — ${escape(card.thumbnailSource)}</p>` : ''}` : ''}
  ${passages.length > 0 ? `
  <div style="margin-top:24px">${kicker(card.translation ? "In the article's words, translated" : "In the article's words")}</div>
  <div style="margin-top:12px">${passagesHtml(passages, i === 0)}</div>
  <p class="ng-mute" style="${CAPTION};margin-top:12px;clear:both">${card.translation
        ? `Sentences chosen by the AI in the article${lead ? ` of ${escape(lead.source)}` : ''} and translated by it: it may contain errors, the original is the reference.`
        : `Sentences chosen by the AI, shown as the article${lead ? ` of ${escape(lead.source)}` : ''} published them.`}</p>` : ''}
  ${contestedHtml(card.contested ?? [])}
  ${anglesHtml(card.angles ?? [])}
  ${linksHtml(card)}
  ${notesHtml(card)}
</td></tr>`;
};

// briefing: as toBriefing gives it, its items the cards the reader ticked; profileName: the name of its
// profile; sender: the username of the reader when it is sent to another address than theirs, the
// e-mail says who sends it then, and not the name of the profile. {subject, html, text}
export const briefingMail = (briefing, profileName, {sender = null} = {}) => {
    const cards = briefing.items ?? [];
    const finished = briefing.finishedAt ?? briefing.createdAt;
    const span = briefing.hours > 48 ? `${briefing.hours / 24} days` : `${briefing.hours} hours`;
    const count = `${cards.length} ${cards.length === 1 ? 'story' : 'stories'}`;
    const subject = sender
        ? `${sender} shares ${count} of their NewsGenerator briefing · ${when(finished)}`
        : `Your briefing${profileName ? ` · ${profileName}` : ''} · ${count} · ${when(finished)}`;

    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<link rel="stylesheet" href="${FONTS}"><style>${DARK_STYLE}</style><title>${escape(subject)}</title></head>
<body class="ng-paper" style="margin:0;padding:0;background:${LIGHT.paper}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="ng-paper" style="background:${LIGHT.paper}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;text-align:left">
<tr><td style="padding-bottom:28px">
  ${kicker(sender ? 'NewsGenerator' : `The briefing${profileName ? ` · ${profileName}` : ''}`)}
  <h1 class="ng-ink" style="margin:10px 0 0;font:460 40px/1.05 ${DISPLAY};color:${LIGHT.ink}">${sender ? `From the briefing of ${escape(sender)}` : 'Your briefing'}</h1>
  <p class="ng-ink" style="${CAPTION};font-weight:500;color:${LIGHT.ink};margin-top:14px">Written ${escape(written(finished))}</p>
  <p class="ng-mute" style="${CAPTION};font-weight:500;margin-top:2px">The news of the last ${span}, ${count} ${sender ? `${escape(sender)} chose for you` : 'you chose'}</p>
</td></tr>
${cards.map((card, i) => cardHtml(card, i, !sender)).join('')}
<tr><td class="ng-rule ng-mute" style="padding:24px 0;border-top:1px solid ${LIGHT.rule};${CAPTION}">The key passages are the words of each article, chosen by an AI, never written by it. ${sender ? `Sent by ${escape(sender)} from their briefing on NewsGenerator: answer this e-mail to write to them.` : 'Sent because you asked for it from your briefing on NewsGenerator.'}</td></tr>
</table></td></tr></table></body></html>`;

    const text = [
        `${subject}\n`,
        ...cards.map((card, i) => {
            const lead = card.lead ?? card.articles?.[0];
            return [
                `${String(i + 1).padStart(2, '0')}. ${card.titleTranslation ?? card.title}`,
                sender ? '' : card.why ?? '',
                '',
                paragraphsOf(card.translation || card.summary).join('\n[…]\n'),
                ...(card.contested ?? []).map(denial => `Contested — ${denial.by} denies: "${denial.sentence}" (${denial.source})`),
                ...(card.angles ?? []).map(angle => `Other angle: ${angle.titleTranslation ?? angle.title} (${angle.source}) ${angle.url}`),
                lead ? `Read the article at ${lead.source}: ${lead.url}` : '',
                coverageOf(card.corroboration) ?? '',
                '',
            ].filter((line, j, lines) => line !== '' || lines[j - 1] !== '').join('\n');
        }),
        'The key passages are the words of each article, chosen by an AI, never written by it.',
    ].join('\n');

    return {subject, html, text};
};
