//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: parser.js
//  Description: XML parser from fast-xml-parser
//

"use strict"

import {XMLParser} from 'fast-xml-parser';

// tags that must always be arrays, even when the feed contains only one of them
const ARRAY_TAGS = ['item', 'entry', 'category', 'dc:subject', 'link', 'media:thumbnail', 'media:content'];

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    htmlEntities: true,     // some feeds write "Fed&#x2019;s" instead of "Fed's" (WSJ, Bloomberg)
    isArray: (name) => ARRAY_TAGS.includes(name)
});

// some feeds encode their entities twice ("&amp;#8217;"), the parser decodes the first level only
const NAMED_ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};
const decodeEntities = (value) => value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code) => {
    if (code[0] !== '#') return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
    const number = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return Number.isFinite(number) ? String.fromCodePoint(number) : entity;
});

// get the text of a node which can be a string or an object with attributes ({ "#text": ... })
const text = (node) => {
    if (node === undefined || node === null) return '';
    const value = typeof node === 'object' ? String(node["#text"] ?? '') : String(node);
    return decodeEntities(value).trim();
};

// get the biggest thumbnail url
const thumbnail = (news) => {
    const thumbnails = news['media:thumbnail'] || news['media:content'] || [];
    return thumbnails[thumbnails.length - 1]?.url ?? null;
};

// categories as an array of strings, null if none
const categories = (list, getText) => {
    const result = (list ?? []).map(getText).filter(Boolean);
    return result.length > 0 ? result : null;
};

// format RSS 2.0 and RDF (RSS 1.0) item, RDF gives the date and categories with Dublin Core (dc:date, dc:subject)
const fromRssItem = (news) => ({
    title: text(news.title),
    thumbnail: thumbnail(news),
    link: text(news.link?.[0]) || null,
    pubDate: news.pubDate ?? news['dc:date'] ?? null,
    description: text(news.description),
    category: categories([...(news.category ?? []), ...(news['dc:subject'] ?? [])], text),
});

// format Atom entry
const fromAtomEntry = (news) => {
    const links = news.link ?? [];
    const link = links.find(l => !l.rel || l.rel === 'alternate') ?? links[0];

    return {
        title: text(news.title),
        thumbnail: thumbnail(news),
        link: link?.href ?? null,
        pubDate: news.published ?? news.updated ?? null,
        description: text(news.summary ?? news.content),
        category: categories(news.category, c => c.term ?? text(c)),
    };
};

export const Parser = {
    // XML parsed made with 'fast-xml-parser', supports RSS 2.0, RDF (RSS 1.0) and Atom feeds
    Xml: async (xml) => {
        const data = parser.parse(xml);

        if (data.rss) {
            return (data.rss.channel?.item ?? []).map(fromRssItem);
        }
        // RDF: the items are next to the channel, not inside it
        if (data['rdf:RDF']) {
            const rdf = data['rdf:RDF'];
            return (rdf.item ?? rdf.channel?.item ?? []).map(fromRssItem);
        }
        if (data.feed) {
            return (data.feed.entry ?? []).map(fromAtomEntry);
        }

        return [];
    }

}
