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

// descriptions often contain HTML (<p>, <a>, lists), the client and the AI want plain text
const stripHtml = (value) => value
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[ \t]{2,}/g, ' ');

// a CDATA section written escaped ("&lt;![CDATA[ title ]]&gt;", record.pt) is still one once decoded,
// and stripHtml took it for a tag: every title of the feed was empty
const unwrapCdata = (value) => value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

// get the text of a node which can be a string or an object with attributes ({ "#text": ... })
const text = (node) => {
    if (node === undefined || node === null) return '';
    const value = typeof node === 'object' ? String(node["#text"] ?? '') : String(node);
    return stripHtml(unwrapCdata(decodeEntities(value))).trim();
};

// Some feeds give no title and put it in the description (uol.com.br, 984 of its 1181 news): the
// description is the title then, whole when it is as short as one (160 characters, longer than 99%
// of the titles), else cut at a word. An empty title made every news of such a medium the same news
// in assign_stories (db/add_briefing.sql)
const MAX_TITLE_CHARS = 160;
const withTitle = (item) => {
    if (item.title || !item.description) return item;
    if (item.description.length <= MAX_TITLE_CHARS) return {...item, title: item.description, description: ''};
    const start = item.description.slice(0, MAX_TITLE_CHARS);
    const end = start.lastIndexOf(' ');
    return {...item, title: `${(end > 0 ? start.slice(0, end) : start).trimEnd()}…`};
};

// get the biggest thumbnail url
const thumbnail = (news) => {
    const thumbnails = news['media:thumbnail'] || news['media:content'] || [];
    return thumbnails[thumbnails.length - 1]?.url ?? null;
};

// RSS 2.0 <source url="https://www.bbc.com">bbc.com</source>: the site that first published the news,
// aggregators like Google News give it while their own link only goes through a redirect
const source = (node) => {
    if (!node || typeof node !== 'object' || !node.url) return null;
    return {url: String(node.url), name: text(node)};
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
    source: source(news.source),
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
            return (data.rss.channel?.item ?? []).map(item => withTitle(fromRssItem(item)));
        }
        // RDF: the items are next to the channel, not inside it
        if (data['rdf:RDF']) {
            const rdf = data['rdf:RDF'];
            return (rdf.item ?? rdf.channel?.item ?? []).map(item => withTitle(fromRssItem(item)));
        }
        if (data.feed) {
            return (data.feed.entry ?? []).map(entry => withTitle(fromAtomEntry(entry)));
        }

        return [];
    }

}
