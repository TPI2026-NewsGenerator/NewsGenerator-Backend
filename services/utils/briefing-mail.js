//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: briefing-mail.js
//  Description: The cards of a briefing the reader ticked as an e-mail, laid out as the page shows them
//               (client BriefingCard.jsx): number, countries, date and language, title, why, picture, its
//               sentences in the way the reader chose (bullet points, summary or key passages), who
//               its official source, who denies it, its analysis when it has one, its other angles, where
//               to read it, and the note of its margin. Who tells it is left out: its sources say it
//               already, unless the reader asks for the badges ("Told by 12 media", "Contested", "Official source",
//               "Unconfirmed"), who it is about, the coverage and the affair of a card (the user, 5.11.2026: each a
//               block the reader puts in or leaves out, see withBlocks). Nothing says what is translated, by a machine or the AI (the user, 16.10.2026).
//               In the design of the page since 2.11.2026 (the user: "Apple minimal"): Inter, white and
//               one grey, one blue for the links, hairlines, rounded boxes. Light, or dark when the reader
//               chooses it for the e-mail (the user, 2.11.2026): the e-mail is one or the other, the
//               system of who reads it does not change it. Its hours are the ones of the time zone of the
//               reader's browser, Zurich when it is not given
//

"use strict"

import {languageName} from './language.js';
import {isStanding} from './picture-sizes.js';
import {countryNames} from './country-names.js';
import {ORIGINAL_END, ORIGINAL_START, withoutOriginalMarks} from './original-marks.js';
import {coverageOfCard} from './card-coverage.js';

// The colours and the font of the page (client styles/index.css). Mail apps keep inline styles and simple
// tables only; Inter is asked from Google Fonts, which Apple Mail and Outlook for Mac load, and Gmail
// replaces by the system's font. The colours are inline, the ones of the theme chosen
const LIGHT = {paper: '#FFFFFF', deep: '#F5F5F7', ink: '#1D1D1F', mute: '#6E6E73', rule: '#D2D2D7', action: '#0066CC', accent: '#BF4800', official: '#248A3D', number: '#BEBEC1'};
const DARK = {paper: '#1C1C1E', deep: '#2C2C2E', ink: '#F5F5F7', mute: '#98989D', rule: '#3A3A3C', action: '#2997FF', accent: '#FF9F0A', official: '#30D158', number: '#545456'};
export const THEMES = ['light', 'dark'];
// the hours of the e-mail are the ones of the reader's time zone (the browser tells it, see BriefingApi.email),
// the ones of Zurich when it does not
export const DEFAULT_TIME_ZONE = 'Europe/Zurich';
export const isTimeZone = (name) => {
    if (typeof name !== 'string' || name.length === 0 || name.length > 64) return false;
    try {
        new Intl.DateTimeFormat('en', {timeZone: name});
        return true;
    } catch {
        return false;
    }
};
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
    toldByMedia: 'Told by {count} media',
    toldByOneMedium: 'Told by one medium',
    inLanguages: 'in {count} languages',
    officiallyConfirmed: 'Officially confirmed',
    unconfirmedBadge: 'Unconfirmed',
    whoItIsAbout: 'Who it is about',
    howWidelyTold: 'How widely it is told',
    oneMedium: 'One medium',
    nMedia: '{count} media',
    oneLanguage: '1 language',
    nLanguages: '{count} languages',
    firstToldBy: 'First told by {source}, {date}',
    thisAffair: 'This affair',
    affairStories: '{stories} stories told by {media} media',
    affairFigures: '{media} media · {news} news · {languages} languages',
    reported: 'Reported',
    official: 'Official',
    oneSmallerEvent: '+ 1 smaller event',
    smallerEvents: '+ {count} smaller events',
};
// English writes the apostrophe alone after a name that ends in s: "Chris’ Briefing" (the user, 2.11.2026).
// Not a label: the other languages say it with a word ("le briefing de {name}"), whatever the name ends in
const BRIEFING_OF_S = '{name}’ Briefing';

// The text styles of the page (section title, caption, body-text, lede, link) and what the page puts on its one other
// tone, a rounded box (the AI analysis, who denies, the official sources), in the colours c. The title of a part of a card ("Key
// points", "Same affair, other angles"...) is a title, not a label: 18 px in semibold and the ink, as the page's (the user,
// 06.11.2026: "trop petits et non visibles comme des titres")
const stylesOf = (c) => ({
    heading: `font:600 18px/1.3 ${FONT};letter-spacing:-.01em;color:${c.ink};margin:0`,
    caption: `font:400 13px/1.45 ${FONT};color:${c.mute};margin:0`,
    body: `font:400 17px/1.6 ${FONT};letter-spacing:-.005em;color:${c.ink};margin:0`,
    lede: `font:400 19px/1.55 ${FONT};letter-spacing:-.005em;color:${c.ink};margin:0`,
    link: `color:${c.action};text-decoration:none`,
    box: `margin-top:24px;background:${c.deep};border-radius:18px;padding:16px 20px`,
});

// t: the words of the e-mail in the reader's language (labels, see mail-labels.js), the language the
// names of languages are written in, the locale and the time zone of its dates, and its theme: its name, its
// colours c and the styles s made of them
const toldIn = (language = 'en', labels = LABELS, theme = 'light', timeZone = DEFAULT_TIME_ZONE) => {
    let locale = 'en-GB';
    try {
        if (language !== 'en') locale = Intl.DateTimeFormat.supportedLocalesOf([language])[0] ?? 'en-GB';
    } catch {
        // not a language code: in English
    }
    const named = PALETTES[theme] ? theme : 'light';
    return {labels, language, locale, timeZone: isTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE, theme: named, c: PALETTES[named], s: stylesOf(PALETTES[named])};
};
const ENGLISH = toldIn();
// a label with its {places} filled: the values are HTML already, the label is escaped
const fill = (template, values = {}) => escape(template).replace(/\{(\w+)\}/g, (place, name) => values[name] ?? place);
const fillText = (template, values = {}) => template.replace(/\{(\w+)\}/g, (place, name) => values[name] ?? place);
const when = (iso, t = ENGLISH) => iso ? new Date(iso).toLocaleString(t.locale, {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: t.timeZone}) : '';
const day = (iso, t = ENGLISH) => iso ? new Date(iso).toLocaleDateString(t.locale, {day: 'numeric', month: 'long', year: 'numeric', timeZone: t.timeZone}) : '';
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
const heading = (text, t, tone = 'ink') => `<p style="${t.s.heading}${tone === 'ink' ? '' : `;color:${t.c[tone]}`}">${escape(text)}</p>`;

// The links of the e-mail are of three kinds, as on the page: the one that leads to the article (the blue of the action), the title of an
// item of a list (the ink, a hairline under it), and the name of a medium (the grey, the same hairline). The name of a medium that looks
// like an address ("fss.rs") is turned into a link by the mail apps of phones, blue and underlined, among the grey ones (the user,
// 06.11.2026): it is a link of ours, with the address of its news, or a break nobody sees (a zero-width space) when there is none
const HAIRLINE = (t) => `text-decoration:underline;text-decoration-color:${t.c.rule};text-underline-offset:3px`;
const itemLinkStyle = (t) => `color:${t.c.ink};${HAIRLINE(t)}`;
const mediumHtml = (name, url, t) => webUrl(url)
    ? `<a href="${escape(url)}" style="color:${t.c.mute};${HAIRLINE(t)}">${escape(name)}</a>`
    : escape(name).replace(/(?<=[\p{L}\p{N}])\.(?=\p{L})/gu, '.&#8203;');

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
  ${heading(t.labels.contested, t, 'accent')}
  ${denials.map(denial => `
  <p style="${t.s.body};margin-top:12px"><b>${fill(t.labels.denies, {by: escape(denial.by)})}</b> “${escape(denial.translation || denial.sentence)}”</p>
  <p style="${t.s.caption};margin-top:4px">— ${mediumHtml(denial.source, denial.url, t)}${denial.publishedAt ? `, ${escape(when(denial.publishedAt, t))}` : ''}</p>`).join('')}
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
    const part = (title, html, first) => `<div style="margin-top:${first ? 0 : 20}px">${heading(title, t)}<div style="margin-top:8px">${html}</div></div>`;
    const parts = [
        why.length > 0 && [t.labels.whyItMatters, list(why.map(escape))],
        next.length > 0 && [t.labels.whatNext, list(next.map(line => `<b>${escape(t.labels.if)}</b> ${escape(line.if)}, <b>${escape(t.labels.then)}</b> ${escape(line.then)}`))],
        timeline.length > 0 && [t.labels.storySoFar, timeline.map(item => `<p style="${t.s.caption};color:${t.c.ink};margin-top:6px"><span style="color:${t.c.mute}">${escape(dayOf(item.date, t))}</span> ${webUrl(item.url)
            ? `<a href="${escape(item.url)}" style="${itemLinkStyle(t)}">${escape(item.titleTranslation ?? item.title)}</a>`
            : escape(item.titleTranslation ?? item.title)}${item.medium ? ` <span style="color:${t.c.mute}">· ${mediumHtml(item.medium, item.url, t)}</span>` : ''}</p>`).join('')],
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
  ${heading(t.labels.otherAngles, t)}
  ${angles.map(angle => `
  <p style="margin:14px 0 0"><a href="${escape(angle.url)}" style="font:500 17px/1.45 ${FONT};letter-spacing:-.005em;${itemLinkStyle(t)}">${escape(angle.titleTranslation ?? angle.title)}</a></p>
  <p style="${t.s.caption};margin-top:4px">${together(`${mediumHtml(angle.source, angle.url, t)}${languageMark(angle.language, t)}`)}${angle.publishedAt ? ` · ${escape(when(angle.publishedAt, t))}` : ''}${angle.media > 1 ? ` · ${fill(t.labels.toldBy, {count: escape(angle.media)})}` : ''}</p>`).join('')}
</div>`;
};

// A colour a share of the way from the page's to another one, as a plain hex: mail apps do not all read rgba(), so the tint of a
// badge is mixed here, not made transparent
const mix = (hex, base, share) => {
    const part = (colour, at) => parseInt(colour.slice(1 + at * 2, 3 + at * 2), 16);
    return `#${[0, 1, 2].map(at => Math.round(part(base, at) + (part(hex, at) - part(base, at)) * share).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
};
const PILL = `display:inline-block;margin:0 6px 6px 0;padding:5px 13px;border-radius:999px;font:500 13px/1.3 ${FONT};white-space:nowrap`;
// a pill of a row under the title (client BriefingCard.jsx Glance and the names): tone 'mute' for how widely it is told, 'warn' (orange) for
// what is said against the news or the article says is not confirmed, 'official' (green) for what a party said itself, 'name' for who it
// is about. html: its words, escaped already
const pillHtml = (html, tone, t) => {
    const c = t.c;
    const looks = {
        mute: `background:${c.deep};border:1px solid ${c.deep};color:${c.mute}`,
        warn: `background:${mix(c.accent, c.paper, .1)};border:1px solid ${mix(c.accent, c.paper, .3)};color:${c.accent}`,
        official: `background:${mix(c.official, c.paper, .1)};border:1px solid ${mix(c.official, c.paper, .3)};color:${c.official}`,
        name: `background:${c.paper};border:1px solid ${c.rule};color:${c.action};font-weight:400`,
    };
    return `<span style="${PILL};${looks[tone]}">${html}</span>`;
};

// The words of the first badge: how widely it is told, in the languages it is told in when more than one
const toldByWords = (card, t = ENGLISH) => {
    const media = card.corroboration?.media ?? 0;
    if (media <= 0) return null;
    const languages = new Set((card.articles ?? []).map(article => article.language).filter(Boolean)).size;
    const told = media === 1 ? t.labels.toldByOneMedium : fillText(t.labels.toldByMedia, {count: media});
    return languages > 1 ? `${told} ${fillText(t.labels.inLanguages, {count: languages})}` : told;
};
// The badges of a card the reader asked them for (card.blocks, see withBlocks): the media that tell it, who denies it, the parties that
// said it themselves (the ones with a web address, as the box of them), an article that says itself it is not confirmed. A badge is there
// when its block is on and the card has what it says; the denials, the posts and the words are taken from the card when their block is off
const badgesOf = (card, t = ENGLISH) => {
    if (!card.blocks) return [];
    const L = t.labels;
    const contested = card.contested?.length ?? 0;
    const official = (card.official ?? []).filter(post => webUrl(post.url)).length;
    return [
        card.blocks.media && toldByWords(card, t) && {tone: 'mute', words: toldByWords(card, t)},
        contested > 0 && {tone: 'warn', words: contested === 1 ? L.contested : `${L.contested} (${contested})`},
        official > 0 && {tone: 'official', words: L.officiallyConfirmed},
        card.hedged && {tone: 'warn', words: L.unconfirmedBadge},
    ].filter(Boolean);
};
const badgesHtml = (card, t = ENGLISH) => {
    const badges = badgesOf(card, t);
    return badges.length === 0 ? '' : `<p style="margin:14px 0 0">${badges.map(badge => pillHtml(escape(badge.words), badge.tone, t)).join('')}</p>`;
};
// who it is about: a kicker and a pill for each name, when the reader asked for them
const namesOf = (card) => card.blocks?.names ? (card.names ?? []).map(one => one.name).filter(Boolean) : [];
const namesHtml = (card, t = ENGLISH) => {
    const names = namesOf(card);
    return names.length === 0 ? '' : `
  <div style="margin-top:18px">${heading(t.labels.whoItIsAbout, t)}<p style="margin:10px 0 0">${names.map(name => pillHtml(escape(name), 'name', t)).join('')}</p></div>`;
};

// How widely it is told (client CardCoverage.jsx), from the articles the card holds: the count of media and languages, who told it first,
// the hours the media came in as bars (cells of a table: the only thing every mail app draws), the languages. Only when the reader asks
const coverageWords = (coverage, t = ENGLISH) => [
    coverage.media === 1 ? t.labels.oneMedium : fillText(t.labels.nMedia, {count: coverage.media}),
    coverage.languages.length === 0 ? null : coverage.languages.length === 1 ? t.labels.oneLanguage : fillText(t.labels.nLanguages, {count: coverage.languages.length}),
].filter(Boolean).join(' · ');
const BAR_MAX = 44;
const coverageHtml = (card, t = ENGLISH) => {
    const coverage = card.blocks?.coverage ? coverageOfCard(card) : null;
    if (!coverage) return '';
    const most = Math.max(1, ...coverage.bars.map(bar => bar.count));
    const bars = coverage.bars.length < 2 ? '' : `
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:340px;margin-top:16px"><tr>${coverage.bars.map(bar => {
        const height = bar.count === 0 ? 2 : Math.max(6, Math.round(bar.count / most * BAR_MAX));
        return `<td valign="bottom" height="${BAR_MAX}" style="padding:0 1px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td height="${height}" style="height:${height}px;background:${mix(t.c.mute, t.c.paper, .4)};border-radius:3px 3px 0 0;font-size:0;line-height:0">&nbsp;</td></tr></table></td>`;
    }).join('')}</tr></table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:340px;margin-top:4px"><tr><td style="${t.s.caption}">${escape(when(coverage.first?.at, t))}</td><td align="right" style="${t.s.caption}">${escape(when(coverage.last?.at, t))}</td></tr></table>`;
    return `
<div style="margin-top:36px">
  ${heading(t.labels.howWidelyTold, t)}
  <p style="margin:8px 0 0;font:500 17px/1.35 ${FONT};color:${t.c.ink}">${escape(coverageWords(coverage, t))}</p>
  ${coverage.first ? `<p style="${t.s.caption};margin-top:4px">${fill(t.labels.firstToldBy, {source: mediumHtml(coverage.first.source, coverage.first.url, t), date: escape(when(coverage.first.at, t))})}</p>` : ''}${bars}
  ${coverage.languages.length > 0 ? `<p style="${t.s.caption};margin-top:12px">${escape(coverage.languages.map(one => `${languageName(one.language, t.language)} ${one.media}`).join(' · '))}</p>` : ''}
</div>`;
};
const coverageText = (card, t = ENGLISH) => {
    const coverage = card.blocks?.coverage ? coverageOfCard(card) : null;
    return coverage ? [`${t.labels.howWidelyTold}: ${coverageWords(coverage, t)}${coverage.first ? `. ${fillText(t.labels.firstToldBy, {source: coverage.first.source, date: when(coverage.first.at, t)})}` : ''}`] : [];
};

// The affair of a card (client AffairPanel, see AffairService.forMail): its title, the size of its thread and of its coverage, then its key
// events one under the other, the oldest first, each with a dot: blue, orange when someone denies it, green when a party announced it
// itself (a denial first, as on the line of the page), hollow and dashed when the articles say it is not confirmed. The events that are not
// key are counted in a line. The line of the page cannot be drawn in an e-mail. Only when the reader asks, and the card is an affair
const eventDay = (at, t = ENGLISH) => at ? new Date(at).toLocaleDateString(t.locale, {day: 'numeric', month: 'short', timeZone: t.timeZone}) : '';
const eventsOf = (affair) => {
    const events = [...(affair?.events ?? [])].sort((a, b) => String(a.at).localeCompare(String(b.at)));
    return {keys: events.filter(event => event.kind === 'key'), others: events.filter(event => event.kind !== 'key').length};
};
const smallerEvents = (others, t) => others === 0 ? '' : others === 1 ? t.labels.oneSmallerEvent : fillText(t.labels.smallerEvents, {count: others});
const affairFigures = (affair, t) => {
    const coverage = affair.coverage;
    if (!coverage || !coverage.media) return '';
    const count = (n) => Number(n ?? 0).toLocaleString(t.locale);
    return fillText(t.labels.affairFigures, {media: count(coverage.media), news: count(coverage.news), languages: count(coverage.languages?.length)});
};
const affairStories = (affair, t) => affair.chip ? fillText(t.labels.affairStories, {stories: affair.chip.stories, media: affair.chip.media}) : '';
const affairHtml = (card, t = ENGLISH) => {
    const affair = card.blocks?.affair ? card.affair : null;
    const {keys, others} = eventsOf(affair);
    if (!affair || keys.length + others === 0) return '';
    const c = t.c;
    const row = (event) => {
        const tone = event.denial ? c.accent : event.official ? c.official : c.action;
        const dot = event.reported ? `background:${c.paper};border:2px dashed ${tone}` : `background:${tone};border:2px solid ${tone}`;
        const marks = [event.reported && [t.labels.reported, c.accent], event.official && [t.labels.official, c.official], event.denial && [t.labels.contested, c.accent]].filter(Boolean);
        const title = escape(event.titleTranslation ?? event.title);
        const meta = [event.medium && mediumHtml(event.medium, event.url, t), event.media?.length > 1 && fill(t.labels.toldBy, {count: event.media.length}),
            ...marks.map(([words, colour]) => `<span style="color:${colour};font-weight:500">${escape(words)}</span>`)].filter(Boolean).join(' · ');
        return `<tr>
    <td valign="top" style="padding:7px 10px 0 0;width:12px"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;${dot}"></span></td>
    <td valign="top" style="${t.s.caption};padding:3px 12px 10px 0;white-space:nowrap">${escape(eventDay(event.at, t))}</td>
    <td valign="top" style="padding:0 0 10px">${webUrl(event.url)
        ? `<a href="${escape(event.url)}" style="font:400 15px/1.45 ${FONT};${itemLinkStyle(t)}">${title}</a>`
        : `<span style="font:400 15px/1.45 ${FONT};color:${c.ink}">${title}</span>`}${meta ? `<br><span style="${t.s.caption}">${meta}</span>` : ''}</td>
  </tr>`;
    };
    return `
<div style="margin-top:36px">
  ${heading(t.labels.thisAffair, t)}
  <p style="margin:8px 0 0;font:500 17px/1.35 ${FONT};color:${c.ink}">${escape(affair.title)}</p>
  ${[affairStories(affair, t), affairFigures(affair, t)].filter(Boolean).map(line => `<p style="${t.s.caption};margin-top:4px">${escape(line)}</p>`).join('')}
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-top:14px">${keys.map(row).join('')}</table>
  ${others > 0 ? `<p style="${t.s.caption};margin-top:2px">${escape(smallerEvents(others, t))}</p>` : ''}
</div>`;
};
const affairText = (card, t = ENGLISH) => {
    const affair = card.blocks?.affair ? card.affair : null;
    const {keys, others} = eventsOf(affair);
    if (!affair || keys.length + others === 0) return [];
    return [
        `${t.labels.thisAffair}: ${affair.title}`,
        ...[affairStories(affair, t), affairFigures(affair, t)].filter(Boolean),
        ...keys.map(event => `  ${eventDay(event.at, t)} ${event.titleTranslation ?? event.title}${event.medium ? ` (${event.medium})` : ''}${event.url ? ` ${event.url}` : ''}`),
        ...(others > 0 ? [`  ${smallerEvents(others, t)}`] : []),
    ];
};

// where to read it (client NewsLinks.jsx): the article of the passages, right under its sentences (the user, 06.11.2026), and at the very
// bottom each other medium once that covers it
const SHOWN_OTHERS = 8;
const readHtml = (card, t = ENGLISH) => {
    const lead = card.lead ?? card.articles?.[0];
    if (!lead || !webUrl(lead.url)) return '';
    return `
  <p style="margin:20px 0 0;font:400 15px/1.4 ${FONT}"><a href="${escape(lead.url)}" style="${t.s.link}">${fill(t.labels.readAt, {source: escape(lead.source)})}</a>${lead.trusted ? ` <span style="color:${t.c.accent}">★</span>` : ''}${languageMark(lead.language, t)}</p>`;
};
const alsoHtml = (card, t = ENGLISH) => {
    const lead = card.lead ?? card.articles?.[0];
    const seen = new Set([lead?.source]);
    const others = (card.articles ?? []).filter(other => webUrl(other.url) && !seen.has(other.source) && seen.add(other.source));
    return others.length === 0 ? '' : `
<p style="${t.s.caption};margin-top:32px">${escape(t.labels.alsoCovered)} ${others.slice(0, SHOWN_OTHERS)
        .map(other => together(`${mediumHtml(other.source, other.url, t)}${other.trusted ? ' ★' : ''}${languageMark(other.language, t)}`))
        .join(', ')}${others.length > SHOWN_OTHERS ? ` ${fill(t.labels.andMore, {count: others.length - SHOWN_OTHERS})}` : ''}</p>`;
};

// the posts where a party said the news itself (see official-sources.js), a line each, and its
// statements an article reports, quoted with the medium. Right under the sentences of the card, in a box
// of its own, not a note at its foot (the user, 16.10.2026: to be seen). None left (the reader took them
// out, or none has a web address), no box
// the title of a post in the reader's language when it was translated (briefings since 18.10.2026)
const officialLine = (post, t = ENGLISH) => post.channel === 'reported'
    ? `${fill(t.labels.saidItReported, {party: `<b>${escape(post.party)}</b>`, source: `<a href="${escape(post.url)}" style="${itemLinkStyle(t)}">${escape(post.source)}</a>`})} “${escape(post.translation ?? post.title)}”`
    : `${fill(t.labels.saidIt, {party: `<b>${escape(post.party)}</b>`})} <a href="${escape(post.url)}" style="${itemLinkStyle(t)}">${escape(post.translation ?? post.title)}</a>${post.publishedAt ? `<span style="color:${t.c.mute}">, ${escape(when(post.publishedAt, t))}</span>` : ''}`;
const officialHtml = (given, t = ENGLISH) => {
    const posts = given.filter(post => webUrl(post.url));
    return posts.length === 0 ? '' : `
<div style="${t.s.box}">
  ${heading(t.labels.officialSources, t, 'official')}
  ${posts.map(post => `<p style="${t.s.body};font-size:15px;line-height:1.5;margin-top:8px">${officialLine(post, t)}</p>`).join('')}
</div>`;
};

// the note of the outer column of the page, under the card in the e-mail
// the words of the article translated when it is in another language than the reader's (see
// withHedgedTranslated)
const notesHtml = (card, t = ENGLISH) => !card.hedged ? '' : `
<div style="margin-top:24px;border-top:1px solid ${t.c.rule}">
  <div style="padding-top:12px">${heading(t.labels.notConfirmed, t, 'accent')}<p style="${t.s.caption};color:${t.c.ink};margin-top:4px">${fill(t.labels.unconfirmed, {words: escape(card.hedgedTranslation ?? card.hedged)})}</p></div>
</div>`;

// the title shown: the one the reader wrote for the e-mail (ownTitle), else the translated one
const titleOf = (card) => card.ownTitle ?? card.titleTranslation ?? card.title;
// The countries of who it names, in the reader's language: the ones the reader chose for the e-mail
// (ownCountries, codes, see withOwnCountries) as they are, else the ones found, whatever the title says (see country-names.js)
const countriesOf = (card, t = ENGLISH) => countryNames(Array.isArray(card.ownCountries) ? card.ownCountries : card.countries ?? [], {locale: t.language});

// personal: the why of the card, written to the reader ("that you follow"), left out of an e-mail to
// another; format: the way its sentences are shown (see wayOf)
// the credit of the picture: its medium, or who added the file (see withChosenPictures)
const creditOf = (card, t = ENGLISH) => card.addedBy !== undefined
    ? card.addedBy ? fillText(t.labels.addedBy, {name: card.addedBy}) : t.labels.addedByYou
    : card.thumbnailSource;
// The size of the picture of a card when it is known: an illustration (see illustrations.js), or one of the pictures of its articles that the card was
// written with (pictures); {} otherwise (a file of the reader, a card of before the sizes)
const pictureSizeOf = (card) => card.thumbnail && card.thumbnail === card.illustration?.url ? card.illustration
    : (card.pictures ?? []).find(picture => picture.url === card.thumbnail) ?? {};
// A standing picture of known size narrower, so that it is no higher than MAX_PICTURE_HEIGHT: a portrait of Commons (2:3) would fill a phone's screen at
// 560 px wide
const MAX_PICTURE_HEIGHT = 420;
const pictureWidth = (card) => {
    const {width, height} = pictureSizeOf(card);
    return width > 0 && height > width ? Math.min(560, Math.round(MAX_PICTURE_HEIGHT * width / height)) : 560;
};
// A picture taller than wide (see isStanding) is cut to the 16:9 landscape of the page, nearer its top where the face is (the user, 10.11.2026, a friend: a
// photo in portrait mode): the picture is in a box as high as 56.25% of its width, the picture pulled up by CROP_ANCHOR% of what overflows. Both are
// percentages of the width of the box, so that the crop follows it on a phone. Outlook of Windows (the Word engine, `mso`) does not know the crop, nor the
// overflow: it gets the narrow picture of before. A mail app that does not read the negative margin shows the top of the picture, which is where the face
// is; one that did not read the overflow would show the whole of it over the text below (not tried in the apps themselves: in a browser, and Outlook by its fallback)
const CROP_ANCHOR = 12;
const pictureHtml = (card, src, t) => {
    const size = pictureSizeOf(card);
    const width = pictureWidth(card);
    const narrow = `<img src="${escape(src)}" alt="" width="${width}" style="display:block;width:100%;max-width:${width}px;height:auto;margin-top:20px;border:0;border-radius:18px;background:${t.c.deep}">`;
    if (!isStanding(size)) return narrow;
    const pulled = Math.round(CROP_ANCHOR * (size.height / size.width - 9 / 16) * 100) / 100;
    return `<!--[if mso]>${narrow}<![endif]-->
  <!--[if !mso]><!-->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin-top:20px"><tr><td style="padding:0">
    <div style="height:0;padding-bottom:56.25%;overflow:hidden;border-radius:18px;background:${t.c.deep};font-size:0;line-height:0"><img src="${escape(src)}" alt="" width="560" style="display:block;width:100%;height:auto;margin:-${pulled}% 0 0;border:0"></div>
  </td></tr></table>
  <!--<![endif]-->`;
};
const cardHtml = (card, i, personal = true, format = 'passages', t = ENGLISH, anchor = false) => {
    const sentences = wayOf(card, format, t);
    const credit = creditOf(card, t);
    const countries = countriesOf(card, t);
    // the picture of Wikimedia Commons of who it names, not of the news: said so
    const illustration = Boolean(card.thumbnail) && card.thumbnail === card.illustration?.url;
    // or a file of the reader joined to the e-mail (see mail-pictures.js)
    const picture = webUrl(card.thumbnail) ?? (/^cid:[\w.@-]+$/.test(card.thumbnail ?? '') ? card.thumbnail : null);
    return `
<tr${anchor ? ` id="story-${Number(card.storyId)}"` : ''}><td style="border-top:1px solid ${t.c.rule};padding:28px 0 44px">
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
  ${badgesHtml(card, t)}${namesHtml(card, t)}
  ${personal && card.why ? `<p style="margin:12px 0 0;font:400 20px/1.45 ${FONT};letter-spacing:-.01em;color:${t.c.mute}">${escape(card.why)}</p>` : ''}
  ${picture ? `${pictureHtml(card, picture, t)}
  ${credit ? `<p style="${t.s.caption};margin-top:6px">${escape(illustration ? t.labels.illustration : t.labels.picture)} — ${mediumHtml(credit, null, t)}</p>` : ''}` : ''}
  ${sentences.paragraphs.length > 0 ? `
  <div style="margin-top:28px">${heading(sentences.title, t)}</div>
  <div style="margin-top:12px;overflow:hidden">${WAYS_HTML[sentences.way](sentences.paragraphs, i === 0, t)}</div>` : ''}${readHtml(card, t)}
  ${officialHtml(card.official ?? [], t)}
  ${analysisHtml(card.analysis, t)}
  ${contestedHtml(card.contested ?? [], t)}
  ${anglesHtml(card.angles ?? [], t)}
  ${affairHtml(card, t)}
  ${coverageHtml(card, t)}
  ${alsoHtml(card, t)}
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
// (the default) or 'dark', one of THEMES; timeZone: the one of the reader ("Europe/Paris"), the hours of its cards
// are written in it; anchors: each card has the id "story-<storyId>", for the preview of the editor to show the one chosen (the e-mail sent has none). {subject, html, text}
export const briefingMail = (briefing, {profile = null, sender = null, format = 'passages', language = 'en', labels = LABELS, theme = 'light', timeZone = DEFAULT_TIME_ZONE, anchors = false} = {}) => {
    const t = toldIn(language, labels, theme, timeZone);
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
${cards.map((card, i) => cardHtml(card, i, !sender, format, t, anchors)).join('')}
</table></td></tr></table></body></html>`;

    const text = [
        `${title}\n`,
        ...cards.map((card, i) => {
            const lead = card.lead ?? card.articles?.[0];
            const countries = countriesOf(card, t);
            return [
                `${String(i + 1).padStart(2, '0')}. ${titleOf(card)}${countries.length > 0 ? ` (${countries.join(', ')})` : ''}`,
                ...(badgesOf(card, t).length > 0 ? [badgesOf(card, t).map(badge => badge.words).join(' · ')] : []),
                ...(namesOf(card).length > 0 ? [`${L.whoItIsAbout}: ${namesOf(card).join(', ')}`] : []),
                sender ? '' : card.why ?? '',
                '',
                wayText(wayOf(card, format, t)),
                lead ? `${fillText(L.readAt, {source: lead.source})}: ${lead.url}` : '',
                ...(card.official ?? []).map(post => post.channel === 'reported'
                    ? `${L.officialSource} — ${fillText(L.saidItReported, {party: post.party, source: post.source})} "${post.translation ?? post.title}" ${post.url}`
                    : `${L.officialSource} — ${fillText(L.saidIt, {party: post.party})} ${post.translation ?? post.title} ${post.url}`),
                ...analysisText(card.analysis, t),
                ...(card.contested ?? []).map(denial => `${L.contested} — ${fillText(L.denies, {by: denial.by})} "${denial.translation || denial.sentence}" (${denial.source})`),
                ...(card.angles ?? []).map(angle => `${L.otherAngle} ${angle.titleTranslation ?? angle.title} (${angle.source}) ${angle.url}`),
                ...affairText(card, t),
                ...coverageText(card, t),
                '',
            ].filter((line, j, lines) => line !== '' || lines[j - 1] !== '').join('\n');
        }),
    ].join('\n');

    return {subject, html, text};
};
