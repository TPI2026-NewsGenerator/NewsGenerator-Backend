//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: briefing-mail.js
//  Description: The cards of a briefing the reader ticked as an e-mail, laid out as the page shows them
//               (client BriefingCard.jsx): number, countries, date and language, title, why, picture, its
//               sentences in the way the reader chose (bullet points, summary or key passages), who
//               its official source, who denies it, its analysis when it has one, its other angles, where
//               to read it, and the note of its margin. Who tells it is left out: its sources say it
//               already. Nothing says what is translated, by a machine or the AI (the user, 16.10.2026).
//               In the design of the page since 2.11.2026 (the user: "Apple minimal"): Inter, white and
//               one grey, one blue for the links, hairlines, rounded boxes. Light, or dark when the reader
//               chooses it for the e-mail (the user, 2.11.2026): the e-mail is one or the other, the
//               system of who reads it does not change it
//

"use strict"

import {languageName} from './language.js';
import {countryName, countryNames} from './country-names.js';
import {ORIGINAL_END, ORIGINAL_START, withoutOriginalMarks} from './original-marks.js';

// The colours and the font of the page (client styles/index.css). Mail apps keep inline styles and simple
// tables only; Inter is asked from Google Fonts, which Apple Mail and Outlook for Mac load, and Gmail
// replaces by the system's font. The colours are inline, the ones of the theme chosen
const LIGHT = {paper: '#FFFFFF', deep: '#F5F5F7', ink: '#1D1D1F', mute: '#6E6E73', rule: '#D2D2D7', action: '#0066CC', accent: '#BF4800', number: '#BEBEC1'};
const DARK = {paper: '#1C1C1E', deep: '#2C2C2E', ink: '#F5F5F7', mute: '#98989D', rule: '#3A3A3C', action: '#2997FF', accent: '#FF9F0A', number: '#545456'};
export const THEMES = ['light', 'dark'];
const PALETTES = {light: LIGHT, dark: DARK};
const FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const FONTS = 'https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,400..700;1,14..32,400..700&display=swap';

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[char]);
// an address of the web only: a link or a picture never runs anything
const webUrl = (url) => /^https?:\/\//i.test(String(url ?? '')) ? String(url) : null;
// The words of the e-mail around what its cards say, in English, translated for a reader of another
// language (see mail-labels.js); {name} a value put in when it is written: a name, a number, a link
export const LABELS = {
    keyPoints: 'Key points',
    summary: 'Summary',
    keyPassages: 'Key passages',
    writtenIn: 'Written in {language}',
    picture: 'Picture',
    illustration: 'Illustration',
    addedByYou: 'added by you',
    addedBy: 'added by {name}',
    officialSources: 'Official sources',
    officialSource: 'Official source',
    saidIt: '{party} said it:',
    saidItReported: '{party} said it, reported by {source}:',
    whyItMatters: 'Why it matters',
    whatNext: 'What could come next',
    if: 'If',
    then: 'then',
    storySoFar: 'The story so far',
    contested: 'Contested',
    denies: '{by} denies:',
    otherAngles: 'Same affair, other angles',
    otherAngle: 'Other angle:',
    toldBy: 'told by {count} media',
    readAt: 'Read the article at {source}',
    alsoCovered: 'Also covered by',
    andMore: 'and {count} more',
    notConfirmed: 'Not confirmed',
    unconfirmed: 'unconfirmed: “{words}”',
    briefingOf: '{name}’s Briefing',
    briefing: 'Briefing',
    oneStory: '1 story',
    stories: '{count} stories',
};
// English writes the apostrophe alone after a name that ends in s: "Chris’ Briefing" (the user, 2.11.2026).
// Not a label: the other languages say it with a word ("le briefing de {name}"), whatever the name ends in
const BRIEFING_OF_S = '{name}’ Briefing';

// The text styles of the page (kicker, caption, body-text, lede, link) and what the page puts on its one other
// tone, a rounded box (the AI analysis, who denies, the official sources), in the colours c. A kicker is
// small and quiet, in the case it is written, as on the page
const stylesOf = (c) => ({
    kicker: `font:500 13px/1.3 ${FONT};letter-spacing:0;color:${c.mute};margin:0`,
    caption: `font:400 13px/1.45 ${FONT};color:${c.mute};margin:0`,
    body: `font:400 17px/1.6 ${FONT};letter-spacing:-.005em;color:${c.ink};margin:0`,
    lede: `font:400 19px/1.55 ${FONT};letter-spacing:-.005em;color:${c.ink};margin:0`,
    link: `color:${c.action};text-decoration:none`,
    box: `margin-top:24px;background:${c.deep};border-radius:18px;padding:16px 20px`,
});

// t: the words of the e-mail in the reader's language (labels, see mail-labels.js), the language the
// names of languages are written in, the locale of its dates, and its theme: its name, its colours c and the
// styles s made of them
const toldIn = (language = 'en', labels = LABELS, theme = 'light') => {
    let locale = 'en-GB';
    try {
        if (language !== 'en') locale = Intl.DateTimeFormat.supportedLocalesOf([language])[0] ?? 'en-GB';
    } catch {
        // not a language code: in English
    }
    const named = PALETTES[theme] ? theme : 'light';
    return {labels, language, locale, theme: named, c: PALETTES[named], s: stylesOf(PALETTES[named])};
};
const ENGLISH = toldIn();
// a label with its {places} filled: the values are HTML already, the label is escaped
const fill = (template, values = {}) => escape(template).replace(/\{(\w+)\}/g, (place, name) => values[name] ?? place);
const fillText = (template, values = {}) => template.replace(/\{(\w+)\}/g, (place, name) => values[name] ?? place);
const when = (iso, t = ENGLISH) => iso ? new Date(iso).toLocaleString(t.locale, {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich'}) : '';
const day = (iso, t = ENGLISH) => iso ? new Date(iso).toLocaleDateString(t.locale, {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Zurich'}) : '';
// a sentence the translation left in its own language (see extract.js) is in italics, between its parentheses
const italicOriginals = (html) => html.replaceAll(ORIGINAL_START, '<i>').replaceAll(ORIGINAL_END, '</i>');
const paragraphsOf = (text) => String(text ?? '').split(/\n\s*\n/).map(paragraph => paragraph.trim()).filter(Boolean);

// The ways the sentences of a card can be sent in, as the page shows them (client formats.js): the 3
// most important ones as bullet points, the ones of 5 to 6 lines as one paragraph, the key passages. A
// card of a briefing written before the first two (12.10.2026) has its key passages only
export const MAIL_FORMATS = ['points', 'digest', 'passages'];
const WAYS = {
    points: {text: 'points', translation: 'pointsTranslation', title: 'keyPoints'},
    digest: {text: 'digest', translation: 'digestTranslation', title: 'summary'},
    passages: {text: 'summary', translation: 'translation', title: 'keyPassages'},
};
// {paragraphs, title, way}: the sentences of the card in the way asked, their translation
// when the article is written in another language than the reader's. A card the reader sends in its AI
// version (aiVersion, see ai-ways.js) has the points or the summary the AI wrote in the reader's
// language, without saying so (the user, 15.10.2026), when it has one in that way. The sentences the
// reader wrote for the e-mail (ownText, see withOwnTexts) are sent instead of both, in the way asked
const wayOf = (card, format, t = ENGLISH) => {
    if (card.ownText?.length && WAYS[format]) return {paragraphs: card.ownText, title: t.labels[WAYS[format].title], way: format};
    if (card.aiVersion && format === 'points' && card.ai?.points?.length) {
        return {paragraphs: card.ai.points, title: t.labels[WAYS.points.title], way: 'points'};
    }
    if (card.aiVersion && format === 'digest' && card.ai?.summary) {
        return {paragraphs: [card.ai.summary], title: t.labels[WAYS.digest.title], way: 'digest'};
    }
    const way = format === 'points' && card.points ? 'points' : format === 'digest' && card.digest ? 'digest' : 'passages';
    const {text, translation, title} = WAYS[way];
    return {paragraphs: paragraphsOf(card[translation] || card[text]), title: t.labels[title], way};
};

// the language a source writes in, next to its name (client LanguageMark.jsx). Inline, not
// inline-block: a mail app of the user put each mark on a line of its own, and the medium after it on
// the next one (14.10.2026)
const languageMark = (code, t = ENGLISH) => code
    ? ` <span title="${fill(t.labels.writtenIn, {language: escape(languageName(code, t.language))})}" style="border:1px solid ${t.c.rule};border-radius:5px;padding:0 4px;font:600 11px/1.35 ${FONT};letter-spacing:.04em;color:${t.c.mute};text-transform:uppercase;white-space:nowrap">${escape(code)}</span>`
    : '';
// a medium and its marks kept together on one line
const together = (html) => `<span style="white-space:nowrap">${html}</span>`;
const kicker = (text, t, tone = 'mute') => `<p style="${t.s.kicker}${tone === 'mute' ? '' : `;color:${t.c[tone]}`}">${escape(text)}</p>`;

// the passages, "[…]" between two of them; the first one of the first card a little larger, as on the page
const passagesHtml = (paragraphs, lede, t) => paragraphs.map((paragraph, i) => {
    const gap = i > 0 ? `<p style="${t.s.body};color:${t.c.mute};margin:12px 0">[…]</p>` : '';
    return `${gap}<p style="${lede && i === 0 ? t.s.lede : t.s.body}">${italicOriginals(escape(paragraph))}</p>`;
}).join('');

// the summary: the same in one paragraph, the gaps marked inside it
const digestHtml = (paragraphs, lede, t) => passagesHtml([paragraphs.join(' […] ')], lede, t);

// the bullet points, a sentence each, the most important first
const pointsHtml = (paragraphs, lede, t) => `<ul style="margin:0;padding-left:22px">${paragraphs
    .map(paragraph => `<li style="${t.s.body};margin-top:8px">${italicOriginals(escape(paragraph))}</li>`).join('')}</ul>`;
const WAYS_HTML = {points: pointsHtml, digest: digestHtml, passages: passagesHtml};

// the same in the text of the e-mail
const wayText = ({paragraphs: marked, way}) => {
    const paragraphs = marked.map(withoutOriginalMarks);
    return way === 'points'
        ? paragraphs.map(paragraph => `• ${paragraph}`).join('\n')
        : paragraphs.join(way === 'digest' ? ' […] ' : '\n[…]\n');
};

const contestedHtml = (denials, t = ENGLISH) => denials.length === 0 ? '' : `
<div style="${t.s.box}">
  ${kicker(t.labels.contested, t, 'accent')}
  ${denials.map(denial => `
  <p style="${t.s.body};margin-top:12px"><b>${fill(t.labels.denies, {by: escape(denial.by)})}</b> “${escape(denial.translation || denial.sentence)}”</p>
  <p style="${t.s.caption};margin-top:4px">— ${webUrl(denial.url) ? `<a href="${escape(denial.url)}" style="color:${t.c.mute};text-decoration:underline;text-underline-offset:3px">${escape(denial.source)}</a>` : escape(denial.source)}${denial.publishedAt ? `, ${escape(when(denial.publishedAt, t))}` : ''}</p>`).join('')}
</div>`;

// The AI analysis of the card (see card-analysis.js), the lines the reader kept: why it matters, what
// could come next, the earlier news of its affair. Without the "AI analysis" title nor the note saying
// the AI wrote it, which the page shows (the user, 15.10.2026: not in the e-mail). None kept, none sent
const dayOf = (date, t = ENGLISH) => date ? new Date(`${date}T12:00:00Z`).toLocaleDateString(t.locale, {day: 'numeric', month: 'short', timeZone: 'UTC'}) : '';
const analysisHtml = (analysis, t = ENGLISH) => {
    if (!analysis) return '';
    const why = analysis.why ?? [], next = analysis.next ?? [], timeline = (analysis.timeline ?? []).filter(item => item.title);
    if (why.length + next.length + timeline.length === 0) return '';
    const list = (lines) => `<ul style="margin:0;padding-left:22px">${lines.map(line => `<li style="${t.s.body};margin-top:8px">${line}</li>`).join('')}</ul>`;
    const part = (title, html, first) => `<div style="margin-top:${first ? 0 : 16}px">${kicker(title, t)}${html}</div>`;
    const parts = [
        why.length > 0 && [t.labels.whyItMatters, list(why.map(escape))],
        next.length > 0 && [t.labels.whatNext, list(next.map(line => `<b>${escape(t.labels.if)}</b> ${escape(line.if)}, <b>${escape(t.labels.then)}</b> ${escape(line.then)}`))],
        timeline.length > 0 && [t.labels.storySoFar, timeline.map(item => `<p style="${t.s.caption};color:${t.c.ink};margin-top:6px"><span style="color:${t.c.mute}">${escape(dayOf(item.date, t))}</span> ${webUrl(item.url)
            ? `<a href="${escape(item.url)}" style="color:${t.c.ink};text-decoration:underline;text-decoration-color:${t.c.rule};text-underline-offset:3px">${escape(item.titleTranslation ?? item.title)}</a>`
            : escape(item.titleTranslation ?? item.title)}${item.medium ? ` <span style="color:${t.c.mute}">· ${escape(item.medium)}</span>` : ''}</p>`).join('')],
    ].filter(Boolean);
    return `
<div style="${t.s.box}">
  ${parts.map(([title, html], i) => part(title, html, i === 0)).join('')}
</div>`;
};
const analysisText = (analysis, t = ENGLISH) => {
    if (!analysis) return [];
    const why = analysis.why ?? [], next = analysis.next ?? [], timeline = (analysis.timeline ?? []).filter(item => item.title);
    return [
        ...(why.length > 0 ? [`${t.labels.whyItMatters}:`, ...why.map(line => `• ${line}`)] : []),
        ...(next.length > 0 ? [`${t.labels.whatNext}:`, ...next.map(line => `• ${t.labels.if} ${line.if}, ${t.labels.then} ${line.then}`)] : []),
        ...(timeline.length > 0 ? [`${t.labels.storySoFar}:`, ...timeline.map(item => `  ${dayOf(item.date, t)} ${item.titleTranslation ?? item.title}${item.medium ? ` (${item.medium})` : ''}`)] : []),
    ];
};

// none left (the reader took them out, or none has a web address): no title either
const anglesHtml = (given, t = ENGLISH) => {
    const angles = given.filter(angle => webUrl(angle.url));
    return angles.length === 0 ? '' : `
<div style="margin-top:36px">
  ${kicker(t.labels.otherAngles, t)}
  ${angles.map(angle => `
  <p style="margin:12px 0 0"><a href="${escape(angle.url)}" style="font:600 17px/1.45 ${FONT};letter-spacing:-.005em;color:${t.c.ink};text-decoration:none">${escape(angle.titleTranslation ?? angle.title)}</a></p>
  <p style="${t.s.caption};margin-top:4px">${together(`${escape(angle.source)}${languageMark(angle.language, t)}`)}${angle.publishedAt ? ` · ${escape(when(angle.publishedAt, t))}` : ''}${angle.media > 1 ? ` · ${fill(t.labels.toldBy, {count: escape(angle.media)})}` : ''}</p>`).join('')}
</div>`;
};

// where to read it (client NewsLinks.jsx): the article of the passages, then each other medium once
const SHOWN_OTHERS = 8;
const linksHtml = (card, t = ENGLISH) => {
    const lead = card.lead ?? card.articles?.[0];
    if (!lead || !webUrl(lead.url)) return '';
    const seen = new Set([lead.source]);
    const others = (card.articles ?? []).filter(other => webUrl(other.url) && !seen.has(other.source) && seen.add(other.source));
    return `
<p style="margin:32px 0 0;font:400 15px/1.4 ${FONT}"><a href="${escape(lead.url)}" style="${t.s.link}">${fill(t.labels.readAt, {source: escape(lead.source)})}</a>${lead.trusted ? ` <span style="color:${t.c.accent}">★</span>` : ''}${languageMark(lead.language, t)}</p>
${others.length > 0 ? `<p style="${t.s.caption};margin-top:8px">${escape(t.labels.alsoCovered)} ${others.slice(0, SHOWN_OTHERS)
        .map(other => together(`<a href="${escape(other.url)}" style="color:${t.c.mute};text-decoration:underline;text-decoration-color:${t.c.rule};text-underline-offset:4px">${escape(other.source)}</a>${other.trusted ? ' ★' : ''}${languageMark(other.language, t)}`))
        .join(', ')}${others.length > SHOWN_OTHERS ? ` ${fill(t.labels.andMore, {count: others.length - SHOWN_OTHERS})}` : ''}</p>` : ''}`;
};

// the posts where a party said the news itself (see official-sources.js), a line each, and its
// statements an article reports, quoted with the medium. Right under the sentences of the card, in a box
// of its own, not a note at its foot (the user, 16.10.2026: to be seen). None left (the reader took them
// out, or none has a web address), no box
// the title of a post in the reader's language when it was translated (briefings since 18.10.2026)
const officialLine = (post, t = ENGLISH) => post.channel === 'reported'
    ? `${fill(t.labels.saidItReported, {party: `<b>${escape(post.party)}</b>`, source: `<a href="${escape(post.url)}" style="color:${t.c.ink};text-decoration:underline;text-decoration-color:${t.c.rule};text-underline-offset:3px">${escape(post.source)}</a>`})} “${escape(post.translation ?? post.title)}”`
    : `${fill(t.labels.saidIt, {party: `<b>${escape(post.party)}</b>`})} <a href="${escape(post.url)}" style="color:${t.c.ink};text-decoration:underline;text-decoration-color:${t.c.rule};text-underline-offset:3px">${escape(post.translation ?? post.title)}</a>${post.publishedAt ? `<span style="color:${t.c.mute}">, ${escape(when(post.publishedAt, t))}</span>` : ''}`;
const officialHtml = (given, t = ENGLISH) => {
    const posts = given.filter(post => webUrl(post.url));
    return posts.length === 0 ? '' : `
<div style="${t.s.box}">
  ${kicker(t.labels.officialSources, t)}
  ${posts.map(post => `<p style="${t.s.body};font-size:15px;line-height:1.5;margin-top:8px">${officialLine(post, t)}</p>`).join('')}
</div>`;
};

// the note of the outer column of the page, under the card in the e-mail
// the words of the article translated when it is in another language than the reader's (see
// withHedgedTranslated)
const notesHtml = (card, t = ENGLISH) => !card.hedged ? '' : `
<div style="margin-top:24px;border-top:1px solid ${t.c.rule}">
  <div style="padding-top:12px">${kicker(t.labels.notConfirmed, t, 'accent')}<p style="${t.s.caption};color:${t.c.ink};margin-top:4px">${fill(t.labels.unconfirmed, {words: escape(card.hedgedTranslation ?? card.hedged)})}</p></div>
</div>`;

// the title shown: the one the reader wrote for the e-mail (ownTitle), else the translated one
const titleOf = (card) => card.ownTitle ?? card.titleTranslation ?? card.title;
// The countries of who it names, in the reader's language: the ones the reader chose for the e-mail
// (ownCountries, codes, see withOwnCountries) as they are, else none when its title names them (see
// country-names.js)
const countriesOf = (card, t = ENGLISH) => Array.isArray(card.ownCountries)
    ? card.ownCountries.map(code => countryName(code, t.language))
    : countryNames(card.countries ?? [], {
        titles: [card.ownTitle, card.titleTranslation, card.title], languages: [card.language], locale: t.language,
    });

// personal: the why of the card, written to the reader ("that you follow"), left out of an e-mail to
// another; format: the way its sentences are shown (see wayOf)
// the credit of the picture: its medium, or who added the file (see withChosenPictures)
const creditOf = (card, t = ENGLISH) => card.addedBy !== undefined
    ? card.addedBy ? fillText(t.labels.addedBy, {name: card.addedBy}) : t.labels.addedByYou
    : card.thumbnailSource;
// A standing picture of known size (an illustration, see illustrations.js) narrower, so that it is no
// higher than MAX_PICTURE_HEIGHT: a portrait of Commons (2:3) would fill a phone's screen at 560 px wide
const MAX_PICTURE_HEIGHT = 420;
const pictureWidth = (card) => {
    const {width, height} = card.thumbnail && card.thumbnail === card.illustration?.url ? card.illustration : {};
    return width > 0 && height > width ? Math.min(560, Math.round(MAX_PICTURE_HEIGHT * width / height)) : 560;
};
const cardHtml = (card, i, personal = true, format = 'passages', t = ENGLISH) => {
    const sentences = wayOf(card, format, t);
    const credit = creditOf(card, t);
    const countries = countriesOf(card, t);
    // the picture of Wikimedia Commons of who it names, not of the news: said so
    const illustration = Boolean(card.thumbnail) && card.thumbnail === card.illustration?.url;
    const width = pictureWidth(card);
    // or a file of the reader joined to the e-mail (see mail-pictures.js)
    const picture = webUrl(card.thumbnail) ?? (/^cid:[\w.@-]+$/.test(card.thumbnail ?? '') ? card.thumbnail : null);
    return `
<tr><td style="border-top:1px solid ${t.c.rule};padding:28px 0 44px">
  <!-- the number, countries, date and language above the title, not in a column of their own as on the
       page: on a phone the text keeps the whole width. No topic: the cards of one reader are of the same
       one, "sport" card after card (the user, 18.10.2026) -->
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:14px"><tr>
    <td valign="bottom" style="padding-right:14px"><p style="margin:0;font:600 44px/1 ${FONT};letter-spacing:-.04em;color:${t.c.number}">${String(i + 1).padStart(2, '0')}</p></td>
    <td valign="bottom" style="padding-bottom:4px"><p style="${t.s.caption}">${[
        countries.length > 0 ? `<span style="color:${t.c.ink};font-weight:500">${escape(countries.join(' · '))}</span>` : '',
        card.publishedAt ? escape(when(card.publishedAt, t)) : '',
        card.language ? languageMark(card.language, t).trim() : '',
    ].filter(Boolean).join(' · ')}</p></td>
  </tr></table>
  <h2 style="margin:0;font:600 28px/1.15 ${FONT};letter-spacing:-.022em;color:${t.c.ink}">${escape(titleOf(card))}</h2>
  ${personal && card.why ? `<p style="margin:12px 0 0;font:400 20px/1.45 ${FONT};letter-spacing:-.01em;color:${t.c.mute}">${escape(card.why)}</p>` : ''}
  ${picture ? `<img src="${escape(picture)}" alt="" width="${width}" style="display:block;width:100%;max-width:${width}px;height:auto;margin-top:20px;border:0;border-radius:18px;background:${t.c.deep}">
  ${credit ? `<p style="${t.s.caption};margin-top:6px">${escape(illustration ? t.labels.illustration : t.labels.picture)} — ${escape(credit)}</p>` : ''}` : ''}
  ${sentences.paragraphs.length > 0 ? `
  <div style="margin-top:24px">${kicker(sentences.title, t)}</div>
  <div style="margin-top:12px;overflow:hidden">${WAYS_HTML[sentences.way](sentences.paragraphs, i === 0, t)}</div>` : ''}
  ${officialHtml(card.official ?? [], t)}
  ${analysisHtml(card.analysis, t)}
  ${contestedHtml(card.contested ?? [], t)}
  ${anglesHtml(card.angles ?? [], t)}
  ${linksHtml(card, t)}
  ${notesHtml(card, t)}
</td></tr>`;
};

// briefing: as toBriefing gives it, its items the cards the reader ticked (ownTitle: a title they wrote
// for the e-mail); profile: the name of the profile it was written for, in its title and subject (the
// user, 13.10.2026: the name of the profile, never the one of the account); sender: the username of the
// reader when it is sent to another address than theirs (the reasons the cards were chosen for them are
// left out then, who sends it is in its Reply-To); format: the way the sentences of the cards are shown,
// one of MAIL_FORMATS. The day only, no hour, in its subject and its title, the day before the count in
// the subject (the user, 16.10.2026); nothing under the title (the user, 14.10.2026: no "N stories
// shared" line, the title alone). language: the reader's, a code: its dates and the names of languages
// are written in it; labels: the words of the e-mail in it (see labelsFor), English when not given; theme: 'light'
// (the default) or 'dark', one of THEMES. {subject, html, text}
export const briefingMail = (briefing, {profile = null, sender = null, format = 'passages', language = 'en', labels = LABELS, theme = 'light'} = {}) => {
    const t = toldIn(language, labels, theme);
    const L = t.labels;
    const cards = briefing.items ?? [];
    const finished = briefing.finishedAt ?? briefing.createdAt;
    const count = cards.length === 1 ? L.oneStory : fillText(L.stories, {count: cards.length});
    // "Roberto’s Briefing · 13 October 2026", "Chris’ Briefing · 2 November 2026"
    const possessive = language === 'en' && /s$/i.test(String(profile ?? '').trim()) ? BRIEFING_OF_S : L.briefingOf;
    const name = profile ? fillText(possessive, {name: profile}) : L.briefing;
    const title = `${name} · ${day(finished, t)}`;
    const subject = `${name} · ${day(finished, t)} · ${count}`;

    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="${t.theme}"><meta name="supported-color-schemes" content="${t.theme}">
<link rel="stylesheet" href="${FONTS}"><style>:root{color-scheme:${t.theme};supported-color-schemes:${t.theme}}</style><title>${escape(subject)}</title></head>
<body style="margin:0;padding:0;background:${t.c.paper}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${t.c.paper}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;text-align:left">
<tr><td style="padding-bottom:28px">
  <h1 style="margin:0;font:600 38px/1.05 ${FONT};letter-spacing:-.035em;color:${t.c.ink}">${escape(title)}</h1>
</td></tr>
${cards.map((card, i) => cardHtml(card, i, !sender, format, t)).join('')}
</table></td></tr></table></body></html>`;

    const text = [
        `${title}\n`,
        ...cards.map((card, i) => {
            const lead = card.lead ?? card.articles?.[0];
            const countries = countriesOf(card, t);
            return [
                `${String(i + 1).padStart(2, '0')}. ${titleOf(card)}${countries.length > 0 ? ` (${countries.join(', ')})` : ''}`,
                sender ? '' : card.why ?? '',
                '',
                wayText(wayOf(card, format, t)),
                ...(card.official ?? []).map(post => post.channel === 'reported'
                    ? `${L.officialSource} — ${fillText(L.saidItReported, {party: post.party, source: post.source})} "${post.translation ?? post.title}" ${post.url}`
                    : `${L.officialSource} — ${fillText(L.saidIt, {party: post.party})} ${post.translation ?? post.title} ${post.url}`),
                ...analysisText(card.analysis, t),
                ...(card.contested ?? []).map(denial => `${L.contested} — ${fillText(L.denies, {by: denial.by})} "${denial.translation || denial.sentence}" (${denial.source})`),
                ...(card.angles ?? []).map(angle => `${L.otherAngle} ${angle.titleTranslation ?? angle.title} (${angle.source}) ${angle.url}`),
                lead ? `${fillText(L.readAt, {source: lead.source})}: ${lead.url}` : '',
                '',
            ].filter((line, j, lines) => line !== '' || lines[j - 1] !== '').join('\n');
        }),
    ].join('\n');

    return {subject, html, text};
};
