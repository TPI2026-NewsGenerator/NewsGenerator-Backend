//
//  Author: Fabian Rostello
//  Date: 04.11.2026
//  File: affair-coverage.js
//  Description: How widely the media talked of an affair: how many, which, since when, in which languages, day by
//               day. Counted from the news we read, nothing else: it says how much an affair is told, never whether
//               it is true (see docs/briefing/corroboration)
//

"use strict"

const ZONE = 'Europe/Zurich';
const FUTURE_MS = 12 * 3600e3;
const dayKey = (date) => date.toLocaleDateString('en-CA', {timeZone: ZONE});

// Every day from the first to the last, the ones nobody wrote on too (a curve with holes is a different curve)
const daysBetween = (first, last) => {
    const days = [];
    for (let at = +first; days.length < 400; at += 24 * 3600e3) {
        const key = dayKey(new Date(at));
        if (!days.includes(key)) days.push(key);
        if (key >= dayKey(last)) break;
    }
    return days;
};

// stories: [{lang, news: [{link, medium, lang, at}]}], the stories of the affair in any language. now: the date
// the future is counted from (a feed dating a news ahead of us). Answers {media, news, first, peak, days,
// languages, byMedium}: media the number of different media, news the number of different links, first {medium,
// at} the first to tell it, days [{day, media, news}] (media: the different media that wrote that day), languages [{language, media, news}] the most told first, byMedium [{medium, news, firstAt,
// languages}] the first to tell it first
export const coverageOf = (stories, now = new Date()) => {
    const seen = new Set();
    const rows = [];
    for (const story of stories) {
        for (const item of story.news) {
            const at = new Date(item.at);
            if (!item.link || seen.has(item.link) || Number.isNaN(at.getTime()) || at > +now + FUTURE_MS) continue;
            seen.add(item.link);
            rows.push({medium: item.medium || null, language: item.lang || story.lang, at});
        }
    }
    if (rows.length === 0) return {media: 0, news: 0, first: null, peak: null, days: [], languages: [], byMedium: []};
    rows.sort((a, b) => a.at - b.at);

    const perDay = new Map();
    const perLanguage = new Map();
    const perMedium = new Map();
    for (const row of rows) {
        const day = perDay.get(dayKey(row.at)) ?? {media: new Set(), news: 0};
        day.news++;
        if (row.medium) day.media.add(row.medium);
        perDay.set(dayKey(row.at), day);

        const language = perLanguage.get(row.language) ?? {media: new Set(), news: 0};
        language.news++;
        if (row.medium) language.media.add(row.medium);
        perLanguage.set(row.language, language);

        if (row.medium) {
            const medium = perMedium.get(row.medium) ?? {medium: row.medium, news: 0, firstAt: row.at, languages: new Set()};
            medium.news++;
            medium.languages.add(row.language);
            perMedium.set(row.medium, medium);
        }
    }
    const days = daysBetween(rows[0].at, rows[rows.length - 1].at).map(day => ({day, media: perDay.get(day)?.media.size ?? 0, news: perDay.get(day)?.news ?? 0}));
    const peak = days.reduce((best, day) => day.media > best.media ? day : best, days[0]);
    const byMedium = [...perMedium.values()].sort((a, b) => a.firstAt - b.firstAt || b.news - a.news)
        .map(medium => ({...medium, firstAt: medium.firstAt.toISOString(), languages: [...medium.languages]}));
    return {
        media: perMedium.size,
        news: rows.length,
        first: byMedium[0] ? {medium: byMedium[0].medium, at: byMedium[0].firstAt} : null,
        peak: {day: peak.day, media: peak.media},
        days,
        languages: [...perLanguage].map(([language, one]) => ({language, media: one.media.size, news: one.news})).sort((a, b) => b.media - a.media || b.news - a.news),
        byMedium,
    };
};

// The coverage kept and the one counted now over the news we still hold (the last 30 days): the days older than
// what we hold stay as they were, the others are the new count; the media are those of both, each since the first
// day it was seen. media and news are the totals over the days, so they only grow
export const mergedCoverage = (previous, current) => {
    if (!previous || previous.media === 0) return current;
    if (!current || current.media === 0) return previous;
    const byDay = new Map(previous.days.map(day => [day.day, day]));
    for (const day of current.days) {
        const was = byDay.get(day.day);
        byDay.set(day.day, was && was.news > day.news ? was : day);
    }
    const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
    const byMedium = new Map(previous.byMedium.map(one => [one.medium, one]));
    for (const one of current.byMedium) {
        const was = byMedium.get(one.medium);
        byMedium.set(one.medium, was ? {...one, news: Math.max(was.news, one.news), firstAt: was.firstAt < one.firstAt ? was.firstAt : one.firstAt,
            languages: [...new Set([...was.languages, ...one.languages])]} : one);
    }
    const media = [...byMedium.values()].sort((a, b) => a.firstAt.localeCompare(b.firstAt) || b.news - a.news);
    const peak = days.reduce((best, day) => day.media > best.media ? day : best, days[0]);
    return {
        media: media.length,
        news: days.reduce((sum, day) => sum + day.news, 0),
        first: media[0] ? {medium: media[0].medium, at: media[0].firstAt} : null,
        peak: {day: peak.day, media: peak.media},
        days,
        languages: current.languages,
        byMedium: media,
    };
};
