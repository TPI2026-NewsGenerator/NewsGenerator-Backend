//
//  Author: Fabian Rostello
//  Date: 14.10.2026
//  File: titles.js
//  Description: The title of a news as a card shows it: without the name of its medium or a date its
//               feed adds at the end, and whole when the feed cut it
//

"use strict"

// the words of a medium's address that are not its name
const NOT_NAMES = new Set(['www', 'com', 'net', 'org', 'info', 'news', 'co', 'online']);
const compact = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// the names a medium goes by in its address: "crhoy.com" -> ["crhoy"], "rmcsport.bfmtv.com" ->
// ["rmcsport", "bfmtv"]; the country at the end left out
const namesOf = (medium) => {
    const labels = (medium ?? '').toLowerCase().split('.').filter(Boolean);
    return labels.slice(0, -1).filter(label => label.length >= 3 && !NOT_NAMES.has(label)).map(compact);
};

// whether the end of a title starts with the name of its medium, its first words joined: "Goal.com
// Français" for goal.com, "CR Hoy" for crhoy.com, "YSscores" for ysscores.com; not "Trend’s
// calculations" for trend.az, a part of the title. Longer, it is the title's own words: "Sky Sports
// pundits have their say!", "'Murcia Plaza' presentará la tercera edición..."
const MAX_NAME_WORDS = 4;
const namesMedium = (end, medium) => {
    const names = new Set(namesOf(medium));
    if (end.split(/\s+/).length > MAX_NAME_WORDS) return false;
    const words = end.split(/[^\p{L}\p{N}'’]+/u).map(compact).filter(Boolean);
    let joined = '';
    return words.some(word => names.has(joined += word));
};

// a date as some feeds add it: "15/10/2026", "October 15th 2026", "15th October 2026", "October 13, 2026"
const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december';
const DATE = new RegExp(String.raw`^(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|(?:\d{1,2}(?:st|nd|rd|th)? )?(?:${MONTHS})(?: \d{1,2}(?:st|nd|rd|th)?)?,? \d{4})$`, 'i');

// the last part after " | ", " - ", " – " or " — "
const END = /\s+[|\-–—]\s+([^|\-–—]+)$/u;
const MIN_LEFT = 15;    // what is left must still be a title

// Measured on the 150 000 news of a day (14.10.2026, bench/titles-clean.mjs): 678 titles cleaned, their
// end the medium's name (goal.com 109, crhoy.com 92, ysscores.com 87, news18.com 37) or a date
// (footix.fr 68, sportskeeda.com 61). Kept: a section ("Opinion", "Resumen"), an author, the real
// source of an aggregator ("El Comercio" on apnoticias.pe)
export const cleanTitle = (title, medium) => {
    let text = (title ?? '').trim();
    for (let i = 0; i < 2; i++) {
        const found = text.match(END);
        if (!found) break;
        const end = found[1].trim();
        const left = text.slice(0, found.index).trim();
        if (left.length < MIN_LEFT || !(DATE.test(end) || namesMedium(end, medium))) break;
        text = left;
    }
    return text;
};

// whether a title was cut by its feed: "Notable absence of Spanish referees in Europe raises…"
const CUT = /(?:…|\.\.\.)$/u;
export const isCut = (title) => CUT.test((title ?? '').trim());

// The title of the page read when the feed cut the one of the news and the page's starts the same:
// the title as it is otherwise
export const wholeTitle = (title, pageTitle, medium) => {
    if (!isCut(title) || !pageTitle) return title;
    const start = compact(title.replace(CUT, ''));
    const whole = cleanTitle(pageTitle, medium);
    return start.length > 0 && compact(whole).startsWith(start) && compact(whole).length > start.length ? whole : title;
};
