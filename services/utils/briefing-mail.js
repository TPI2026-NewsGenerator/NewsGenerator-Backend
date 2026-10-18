//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: briefing-mail.js
//  Description: The cards of a briefing the reader ticked as an e-mail, laid out as the page shows them
//               (client BriefingCard.jsx): number, topic, date and language, title, why, picture, its
//               sentences in the way the reader chose (bullet points, summary or key passages), who
//               its official source, who denies it, its analysis when it has one, its other angles, where
//               to read it, and the note of its margin. Who tells it is left out: its sources say it
//               already. Nothing says what is translated, by a machine or the AI (the user, 16.10.2026)
//

"use strict"

import {languageName} from './language.js';
import {TOPICS} from './topics.js';

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
// The words of the e-mail around what its cards say, in English, translated for a reader of another
// language (see mail-labels.js); {name} a value put in when it is written: a name, a number, a link
export const LABELS = {
    keyPoints: 'Key points',
    summary: 'Summary',
    keyPassages: 'Key passages',
    writtenIn: 'Written in {language}',
    picture: 'Picture',
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
    // the topic of a card (see topics.js), as a word
    ...Object.fromEntries(TOPICS.map(topic => [`topic.${topic}`, topic])),
};

// t: the words of the e-mail in the reader's language (labels, see mail-labels.js), the language the
// names of languages are written in, and the locale of its dates
const toldIn = (language = 'en', labels = LABELS) => {
    let locale = 'en-GB';
    try {
        if (language !== 'en') locale = Intl.DateTimeFormat.supportedLocalesOf([language])[0] ?? 'en-GB';
    } catch {
        // not a language code: in English
    }
    return {labels, language, locale};
};
const ENGLISH = toldIn();
// a label with its {places} filled: the values are HTML already, the label is escaped
const fill = (template, values = {}) => escape(template).replace(/\{(\w+)\}/g, (place, name) => values[name] ?? place);
const fillText = (template, values = {}) => template.replace(/\{(\w+)\}/g, (place, name) => values[name] ?? place);
const when = (iso, t = ENGLISH) => iso ? new Date(iso).toLocaleString(t.locale, {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich'}) : '';
const day = (iso, t = ENGLISH) => iso ? new Date(iso).toLocaleDateString(t.locale, {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Zurich'}) : '';
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
// language, without saying so (the user, 15.10.2026), when it has one in that way
const wayOf = (card, format, t = ENGLISH) => {
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
  .ng-secondary{background:${DARK.secondary}!important}
}`;

// the language a source writes in, next to its name (client LanguageMark.jsx). Inline, not
// inline-block: a mail app of the user put each mark on a line of its own, and the medium after it on
// the next one (14.10.2026)
const languageMark = (code, t = ENGLISH) => code
    ? ` <span class="ng-box" title="${fill(t.labels.writtenIn, {language: escape(languageName(code, t.language))})}" style="border:1px solid ${LIGHT.rule};padding:0 4px;font:500 11px/1.35 ${MONO};letter-spacing:.04em;color:${LIGHT.mute};text-transform:uppercase;white-space:nowrap">${escape(code)}</span>`
    : '';
// a medium and its marks kept together on one line
const together = (html) => `<span style="white-space:nowrap">${html}</span>`;
const kicker = (text, tone = 'mute') => `<p class="ng-${tone}" style="${KICKER}${tone === 'mute' ? '' : `;color:${LIGHT[tone]}`}">${escape(text)}</p>`;

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

const contestedHtml = (denials, t = ENGLISH) => denials.length === 0 ? '' : `
<div class="ng-rule" style="margin-top:24px;border-left:2px solid ${LIGHT.accent};padding-left:18px">
  ${kicker(t.labels.contested, 'accent')}
  ${denials.map(denial => `
  <p class="ng-ink" style="${BODY};margin-top:12px"><b>${fill(t.labels.denies, {by: escape(denial.by)})}</b> “${escape(denial.translation || denial.sentence)}”</p>
  <p class="ng-mute" style="${CAPTION};margin-top:4px">— ${webUrl(denial.url) ? `<a href="${escape(denial.url)}" class="ng-mute" style="color:${LIGHT.mute}">${escape(denial.source)}</a>` : escape(denial.source)}${denial.publishedAt ? `, ${escape(when(denial.publishedAt, t))}` : ''}</p>`).join('')}
</div>`;

// The AI analysis of the card (see card-analysis.js), the lines the reader kept: why it matters, what
// could come next, the earlier news of its affair. Without the "AI analysis" title nor the note saying
// the AI wrote it, which the page shows (the user, 15.10.2026: not in the e-mail). None kept, none sent
const dayOf = (date, t = ENGLISH) => date ? new Date(`${date}T12:00:00Z`).toLocaleDateString(t.locale, {day: 'numeric', month: 'short', timeZone: 'UTC'}) : '';
const analysisHtml = (analysis, t = ENGLISH) => {
    if (!analysis) return '';
    const why = analysis.why ?? [], next = analysis.next ?? [], timeline = (analysis.timeline ?? []).filter(item => item.title);
    if (why.length + next.length + timeline.length === 0) return '';
    const list = (lines) => `<ul style="margin:0;padding-left:22px">${lines.map(line => `<li class="ng-ink" style="${BODY};margin-top:8px">${line}</li>`).join('')}</ul>`;
    const part = (title, html, first) => `<div style="margin-top:${first ? 0 : 14}px">${kicker(title)}${html}</div>`;
    const parts = [
        why.length > 0 && [t.labels.whyItMatters, list(why.map(escape))],
        next.length > 0 && [t.labels.whatNext, list(next.map(line => `<b>${escape(t.labels.if)}</b> ${escape(line.if)}, <b>${escape(t.labels.then)}</b> ${escape(line.then)}`))],
        timeline.length > 0 && [t.labels.storySoFar, timeline.map(item => `<p class="ng-ink" style="${CAPTION};color:${LIGHT.ink};margin-top:6px"><span class="ng-mute" style="color:${LIGHT.mute}">${escape(dayOf(item.date, t))}</span> ${webUrl(item.url)
            ? `<a href="${escape(item.url)}" class="ng-ink" style="color:${LIGHT.ink};text-decoration:underline;text-decoration-color:${LIGHT.rule}">${escape(item.titleTranslation ?? item.title)}</a>`
            : escape(item.titleTranslation ?? item.title)}${item.medium ? ` <span class="ng-mute" style="color:${LIGHT.mute}">· ${escape(item.medium)}</span>` : ''}</p>`).join('')],
    ].filter(Boolean);
    return `
<div class="ng-rule" style="margin-top:24px;border-left:2px solid ${LIGHT.accent};padding-left:18px">
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
<div class="ng-rule" style="margin-top:28px;border-left:2px solid ${LIGHT.rule};padding-left:18px">
  ${kicker(t.labels.otherAngles)}
  ${angles.map(angle => `
  <p style="margin:12px 0 0"><a href="${escape(angle.url)}" class="ng-ink" style="font:600 17px/1.45 ${TEXT};color:${LIGHT.ink};text-decoration:none">${escape(angle.titleTranslation ?? angle.title)}</a></p>
  <p class="ng-mute" style="${CAPTION};margin-top:4px">${together(`${escape(angle.source)}${languageMark(angle.language, t)}`)}${angle.publishedAt ? ` · ${escape(when(angle.publishedAt, t))}` : ''}${angle.media > 1 ? ` · ${fill(t.labels.toldBy, {count: escape(angle.media)})}` : ''}</p>`).join('')}
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
<p style="margin:28px 0 0;font:16px/1.4 ${TEXT}"><a href="${escape(lead.url)}" class="ng-accent" style="${LINK}">${fill(t.labels.readAt, {source: escape(lead.source)})}</a>${lead.trusted ? ` <span class="ng-accent" style="color:${LIGHT.accent}">★</span>` : ''}${languageMark(lead.language, t)}</p>
${others.length > 0 ? `<p class="ng-mute" style="${CAPTION};margin-top:8px">${escape(t.labels.alsoCovered)} ${others.slice(0, SHOWN_OTHERS)
        .map(other => together(`<a href="${escape(other.url)}" class="ng-mute" style="color:${LIGHT.mute};text-decoration:underline;text-decoration-color:${LIGHT.rule}">${escape(other.source)}</a>${other.trusted ? ' ★' : ''}${languageMark(other.language, t)}`))
        .join(', ')}${others.length > SHOWN_OTHERS ? ` ${fill(t.labels.andMore, {count: others.length - SHOWN_OTHERS})}` : ''}</p>` : ''}`;
};

// the posts where a party said the news itself (see official-sources.js), a line each, and its
// statements an article reports, quoted with the medium. Right under the sentences of the card, in a box
// of its own, not a note at its foot (the user, 16.10.2026: to be seen). None left (the reader took them
// out, or none has a web address), no box
// the title of a post in the reader's language when it was translated (briefings since 18.10.2026)
const officialLine = (post, t = ENGLISH) => post.channel === 'reported'
    ? `${fill(t.labels.saidItReported, {party: `<b>${escape(post.party)}</b>`, source: `<a href="${escape(post.url)}" class="ng-ink" style="color:${LIGHT.ink};text-decoration:underline;text-decoration-color:${LIGHT.rule}">${escape(post.source)}</a>`})} “${escape(post.translation ?? post.title)}”`
    : `${fill(t.labels.saidIt, {party: `<b>${escape(post.party)}</b>`})} <a href="${escape(post.url)}" class="ng-ink" style="color:${LIGHT.ink};text-decoration:underline;text-decoration-color:${LIGHT.rule}">${escape(post.translation ?? post.title)}</a>${post.publishedAt ? `<span class="ng-mute" style="color:${LIGHT.mute}">, ${escape(when(post.publishedAt, t))}</span>` : ''}`;
const officialHtml = (given, t = ENGLISH) => {
    const posts = given.filter(post => webUrl(post.url));
    return posts.length === 0 ? '' : `
<div class="ng-secondary ng-rule" style="margin-top:24px;background:${LIGHT.secondary};border-left:3px solid ${LIGHT.ink};padding:14px 18px">
  ${kicker(t.labels.officialSources, 'ink')}
  ${posts.map(post => `<p class="ng-ink" style="${BODY};margin-top:8px">${officialLine(post, t)}</p>`).join('')}
</div>`;
};

// the note of the outer column of the page, under the card in the e-mail
// the words of the article translated when it is in another language than the reader's (see
// withHedgedTranslated)
const notesHtml = (card, t = ENGLISH) => !card.hedged ? '' : `
<div class="ng-rule" style="margin-top:24px;border-top:1px solid ${LIGHT.rule}">
  <div style="padding-top:12px">${kicker(t.labels.notConfirmed, 'accent')}<p class="ng-ink" style="${CAPTION};color:${LIGHT.ink};margin-top:4px">${fill(t.labels.unconfirmed, {words: escape(card.hedgedTranslation ?? card.hedged)})}</p></div>
</div>`;

// the title shown: the one the reader wrote for the e-mail (ownTitle), else the translated one
const titleOf = (card) => card.ownTitle ?? card.titleTranslation ?? card.title;

// personal: the why of the card, written to the reader ("that you follow"), left out of an e-mail to
// another; format: the way its sentences are shown (see wayOf)
// the credit of the picture: its medium, or who added the file (see withChosenPictures)
const creditOf = (card, t = ENGLISH) => card.addedBy !== undefined
    ? card.addedBy ? fillText(t.labels.addedBy, {name: card.addedBy}) : t.labels.addedByYou
    : card.thumbnailSource;
const cardHtml = (card, i, personal = true, format = 'passages', t = ENGLISH) => {
    const sentences = wayOf(card, format, t);
    const credit = creditOf(card, t);
    // or a file of the reader joined to the e-mail (see mail-pictures.js)
    const picture = webUrl(card.thumbnail) ?? (/^cid:[\w.@-]+$/.test(card.thumbnail ?? '') ? card.thumbnail : null);
    return `
<tr><td class="ng-rule" style="border-top:1px solid ${LIGHT.rule};padding:26px 0 44px">
  <!-- the number, topic, date and language above the title, not in a column of their own as on the
       page: on a phone the text keeps the whole width -->
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:14px"><tr>
    <td valign="bottom" style="padding-right:14px"><p class="ng-mute" style="margin:0;font:400 46px/1 ${DISPLAY};color:${LIGHT.mute}">${String(i + 1).padStart(2, '0')}</p></td>
    <td valign="bottom" style="padding-bottom:4px"><p class="ng-mute" style="${CAPTION};font-weight:500">${[
        card.topic ? `<span class="ng-ink" style="${KICKER};color:${LIGHT.ink}">${escape(t.labels[`topic.${card.topic}`] ?? card.topic)}</span>` : '',
        card.publishedAt ? escape(when(card.publishedAt, t)) : '',
        card.language ? languageMark(card.language, t).trim() : '',
    ].filter(Boolean).join(' · ')}</p></td>
  </tr></table>
  <h2 class="ng-ink" style="margin:0;font:460 27px/1.12 ${DISPLAY};letter-spacing:-.005em;color:${LIGHT.ink}">${escape(titleOf(card))}</h2>
  ${personal && card.why ? `<p class="ng-mute" style="margin:12px 0 0;font:italic 19px/1.4 ${TEXT};color:${LIGHT.mute}">${escape(card.why)}</p>` : ''}
  ${picture ? `<img src="${escape(picture)}" alt="" width="560" style="display:block;width:100%;max-width:560px;height:auto;margin-top:20px;border:0;background:${LIGHT.secondary}">
  ${credit ? `<p class="ng-mute" style="${CAPTION};margin-top:6px">${escape(t.labels.picture)} — ${escape(credit)}</p>` : ''}` : ''}
  ${sentences.paragraphs.length > 0 ? `
  <div style="margin-top:24px">${kicker(sentences.title)}</div>
  <div style="margin-top:12px;overflow:hidden">${WAYS_HTML[sentences.way](sentences.paragraphs, i === 0)}</div>` : ''}
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
// are written in it; labels: the words of the e-mail in it (see labelsFor), English when not given.
// {subject, html, text}
export const briefingMail = (briefing, {profile = null, sender = null, format = 'passages', language = 'en', labels = LABELS} = {}) => {
    const t = toldIn(language, labels);
    const L = t.labels;
    const cards = briefing.items ?? [];
    const finished = briefing.finishedAt ?? briefing.createdAt;
    const count = cards.length === 1 ? L.oneStory : fillText(L.stories, {count: cards.length});
    // "Roberto’s Briefing · 13 October 2026"
    const name = profile ? fillText(L.briefingOf, {name: profile}) : L.briefing;
    const title = `${name} · ${day(finished, t)}`;
    const subject = `${name} · ${day(finished, t)} · ${count}`;

    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<link rel="stylesheet" href="${FONTS}"><style>${DARK_STYLE}</style><title>${escape(subject)}</title></head>
<body class="ng-paper" style="margin:0;padding:0;background:${LIGHT.paper}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="ng-paper" style="background:${LIGHT.paper}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;text-align:left">
<tr><td style="padding-bottom:28px">
  <h1 class="ng-ink" style="margin:0;font:460 40px/1.05 ${DISPLAY};color:${LIGHT.ink}">${escape(title)}</h1>
</td></tr>
${cards.map((card, i) => cardHtml(card, i, !sender, format, t)).join('')}
</table></td></tr></table></body></html>`;

    const text = [
        `${title}\n`,
        ...cards.map((card, i) => {
            const lead = card.lead ?? card.articles?.[0];
            return [
                `${String(i + 1).padStart(2, '0')}. ${titleOf(card)}`,
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
