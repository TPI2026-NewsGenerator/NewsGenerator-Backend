//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: briefing-mail.js
//  Description: A briefing as an e-mail: its cards as the page shows them (title, why, key passages,
//               the media that told it) and the news of the terms the profile follows
//

"use strict"

// mail readers keep only inline styles and simple tables
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[char]);
const paragraphs = (text) => String(text ?? '').split(/\n\n+/).filter(Boolean)
    .map(paragraph => `<p style="margin:0 0 10px;font:16px/1.55 Georgia,serif;color:#1d1b18">${escape(paragraph)}</p>`).join('');
const day = (iso) => iso ? new Date(iso).toLocaleString('en-GB', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich'}) : '';

const cardHtml = (card, i) => {
    const media = card.corroboration?.mediaNames ?? [];
    const passages = card.translation || card.summary;
    return `
<tr><td style="padding:22px 0;border-top:1px solid #e4dfd4">
  <div style="font:12px/1.4 Menlo,Consolas,monospace;color:#6b665e">${i + 1} · ${escape(card.lead?.source ?? '')}${card.language ? ` · ${escape(card.language.toUpperCase())}` : ''}${card.interest ? ` · ${escape(card.interest.split(':')[0])}` : ''}</div>
  <h2 style="margin:6px 0 4px;font:700 21px/1.25 Georgia,serif;color:#1d1b18"><a href="${escape(card.lead?.url ?? '#')}" style="color:#1d1b18;text-decoration:none">${escape(card.titleTranslation ?? card.title)}</a></h2>
  ${card.titleTranslation ? `<div style="margin:0 0 6px;font:italic 14px/1.4 Georgia,serif;color:#6b665e">${escape(card.title)}</div>` : ''}
  ${card.why ? `<div style="margin:0 0 10px;font:15px/1.45 Georgia,serif;color:#b3362f">${escape(card.why)}</div>` : ''}
  ${passages ? paragraphs(passages) : ''}
  ${card.translation ? '<div style="font:12px/1.4 Menlo,Consolas,monospace;color:#6b665e">Machine translation of the passages of the article.</div>' : ''}
  ${media.length > 1 ? `<div style="margin-top:8px;font:13px/1.4 Georgia,serif;color:#6b665e">Also covered by ${media.slice(1, 8).map(escape).join(', ')}${media.length > 8 ? ` and ${media.length - 8} more` : ''}</div>` : ''}
  <div style="margin-top:10px"><a href="${escape(card.lead?.url ?? '#')}" style="font:600 14px Georgia,serif;color:#3c5a78">Read the article →</a></div>
</td></tr>`;
};

const watchedHtml = (watched) => (watched ?? []).filter(group => group.news.length > 0).map(group => `
<tr><td style="padding:18px 0 6px;border-top:1px solid #e4dfd4">
  <h3 style="margin:0 0 6px;font:700 17px Georgia,serif;color:#1d1b18">“${escape(group.term)}” · ${group.count} news</h3>
  ${group.news.slice(0, 15).map(news => `
  <div style="margin:0 0 8px;font:15px/1.4 Georgia,serif">
    <a href="${escape(news.url)}" style="color:#1d1b18">${escape(news.title)}</a>
    <span style="font:12px Menlo,Consolas,monospace;color:#6b665e"> · ${escape(news.source)}${news.language ? ` · ${escape(news.language.toUpperCase())}` : ''} · ${escape(day(news.publishedAt))}${news.media > 1 ? ` · ${news.media} media` : ''}</span>
  </div>`).join('')}
</td></tr>`).join('');

// briefing: as toBriefing gives it, profileName: the name of its profile. {subject, html, text}
export const briefingMail = (briefing, profileName) => {
    const cards = briefing.items ?? [];
    const when = day(briefing.finishedAt ?? briefing.createdAt);
    const subject = `Your briefing${profileName ? ` · ${profileName}` : ''} · ${when}`;
    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#fbf9f4">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbf9f4"><tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px">
<tr><td style="padding-bottom:8px">
  <div style="font:12px Menlo,Consolas,monospace;letter-spacing:.08em;text-transform:uppercase;color:#3c5a78">NewsGenerator${profileName ? ` · ${escape(profileName)}` : ''}</div>
  <h1 style="margin:6px 0 2px;font:700 30px/1.15 Georgia,serif;color:#1d1b18">Your briefing</h1>
  <div style="font:14px Georgia,serif;color:#6b665e">${cards.length} stories of the last ${briefing.hours > 48 ? `${briefing.hours / 24} days` : `${briefing.hours} hours`} · ${escape(when)}</div>
</td></tr>
${cards.map(cardHtml).join('')}
${(briefing.watched ?? []).some(group => group.news.length > 0) ? `<tr><td style="padding:26px 0 4px"><h2 style="margin:0;font:700 22px Georgia,serif;color:#1d1b18">The terms you follow</h2></td></tr>${watchedHtml(briefing.watched)}` : ''}
<tr><td style="padding:24px 0;border-top:1px solid #e4dfd4;font:12px/1.5 Georgia,serif;color:#6b665e">The key passages are the words of each article, chosen by an AI, never written by it. Sent because you asked for it from your briefing.</td></tr>
</table></td></tr></table></body></html>`;

    const text = [
        `${subject}\n`,
        ...cards.map((card, i) => `${i + 1}. ${card.titleTranslation ?? card.title}\n${card.lead?.source ?? ''} ${card.lead?.url ?? ''}\n${card.why ?? ''}\n\n${card.translation || card.summary || ''}\n`),
        ...(briefing.watched ?? []).filter(group => group.news.length > 0)
            .map(group => `"${group.term}" (${group.count})\n${group.news.slice(0, 15).map(news => `- ${news.title} (${news.source}) ${news.url}`).join('\n')}\n`),
    ].join('\n');

    return {subject, html, text};
};
