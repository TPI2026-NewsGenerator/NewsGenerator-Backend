//
//  Author: Fabian Rostello
//  Date: 28.09.2026
//  File: reading-order.js
//  Description: Which articles of a card of the search are read for its resume and to count who
//               wrote it themselves
//

"use strict"

import {mediumOf} from "./public-url.js";

const READ_PER_STORY = 5;       // articles of a card read, as the briefing does

// site name from the article link, e.g. "https://www.nytimes.com/..." -> "nytimes.com"
export const sourceOf = (link) => {
    try {
        return new URL(link).hostname.replace(/^www\./, '');
    } catch {
        return '';
    }
};

export const dateOf = (article) => (article.published_at ?? article.created_at)?.getTime?.() ?? 0;
export const mediumOfArticle = (article) => article.medium ?? mediumOf(sourceOf(article.link));

// articles: rows of the cache with the url of their feed ({feeds: {url}}), the lead of the card first.
// One of a source the reader trusts comes first (the resume is written from the first one that can be
// read), else the lead, then one per other medium, the newest first
export const readingOrder = (articles, trusted = new Set()) => {
    const first = articles.find(article => trusted.has(article.feeds?.url)) ?? articles[0];
    const byMedium = new Map();
    for (const article of [first, ...[...articles].sort((a, b) => dateOf(b) - dateOf(a))]) {
        const medium = mediumOfArticle(article);
        if (!byMedium.has(medium)) byMedium.set(medium, article);
    }
    return [...byMedium.values()].slice(0, READ_PER_STORY);
};
