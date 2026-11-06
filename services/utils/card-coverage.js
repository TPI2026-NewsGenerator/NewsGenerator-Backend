//
//  Author: Fabian Rostello
//  Date: 05.11.2026
//  File: card-coverage.js
//  Description: How widely a card's news is told, from what the card holds: its media, their languages, who told it first and the
//               hours the media came in, for the e-mail (the same count as the page, client features/briefing/cardCoverage.js).
//               Counted from the articles of the card (one per medium), nothing else
//

"use strict"

const HOUR = 3600e3;
const MAX_BARS = 12;

// the width of a bar of the hours: an hour for a news told within the half day, up to 12 hours for a week, 12 bars at most
const binOf = (span) => {
    const wanted = span <= 12 * HOUR ? HOUR : span <= 36 * HOUR ? 3 * HOUR : span <= 4 * 24 * HOUR ? 6 * HOUR : 12 * HOUR;
    // the last article closes a bar of its own: with a span cut in 11, the bars are 12 at most
    return Math.max(wanted, Math.ceil(span / (MAX_BARS - 1) / HOUR) * HOUR);
};

// item: a card of the briefing ({articles: [{source, url, publishedAt, language, trusted}], corroboration: {media}}). Answers null
// when it holds no article, else {media, languages: [{language, media}], first: {source, url, at}, last: {at}, binMs, bars: [{from, count}],
// list: [article]} the media in the order they came in, the ones with no date last. media: the greater of the media the card counts
// and the articles it holds
export const coverageOfCard = (item) => {
    const articles = (item?.articles ?? []).filter(article => article.source);
    if (articles.length === 0) return null;
    const time = (article) => new Date(article.publishedAt).getTime();
    const dated = articles.filter(article => article.publishedAt && !Number.isNaN(time(article))).sort((a, b) => time(a) - time(b));
    const undated = articles.filter(article => !dated.includes(article));

    const perLanguage = new Map();
    for (const article of articles) {
        if (article.language) perLanguage.set(article.language, (perLanguage.get(article.language) ?? 0) + 1);
    }
    const languages = [...perLanguage].map(([language, media]) => ({language, media})).sort((a, b) => b.media - a.media || a.language.localeCompare(b.language));

    let binMs = HOUR;
    let bars = [];
    if (dated.length > 0) {
        const start = time(dated[0]);
        binMs = binOf(time(dated[dated.length - 1]) - start);
        const count = Math.floor((time(dated[dated.length - 1]) - start) / binMs) + 1;
        bars = Array.from({length: count}, (_, i) => ({from: new Date(start + i * binMs), count: 0}));
        for (const article of dated) bars[Math.floor((time(article) - start) / binMs)].count++;
    }
    return {
        media: Math.max(item.corroboration?.media ?? 0, new Set(articles.map(article => article.source)).size),
        languages,
        first: dated[0] ? {source: dated[0].source, url: dated[0].url ?? null, at: dated[0].publishedAt} : null,
        last: dated.length > 0 ? {at: dated[dated.length - 1].publishedAt} : null,
        binMs, bars,
        list: [...dated, ...undated],
    };
};
