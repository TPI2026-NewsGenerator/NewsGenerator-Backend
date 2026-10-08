//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: parser.js
//  Description: XML parser from fast-xml-parser
//

"use strict"

import {XMLParser} from 'fast-xml-parser';
import {parseHTML} from 'linkedom';

// tags that must always be arrays, even when the feed contains only one of them
// (not 'url': the attributes are read under their own name, the url of a thumbnail would be one)
const ARRAY_TAGS = ['item', 'entry', 'category', 'dc:subject', 'link', 'media:thumbnail', 'media:content', 'image:image'];

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    htmlEntities: true,     // some feeds write "Fed&#x2019;s" instead of "Fed's" (WSJ, Bloomberg)
    isArray: (name) => ARRAY_TAGS.includes(name)
});

// some feeds encode their entities twice ("&amp;#8217;"), the parser decodes the first level only.
// The parser knows few names either ("&rsquo;" but not "&eacute;" nor "&egrave;": 16'000 descriptions
// and titles in 7 days on 8.10.2026): the other names are read by linkedom, which knows those of HTML5,
// once each
const NAMED_ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};
const {document} = parseHTML('<html><body></body></html>');
const htmlEntities = new Map();
const namedEntity = (entity, name) => {
    if (NAMED_ENTITIES[name.toLowerCase()]) return NAMED_ENTITIES[name.toLowerCase()];
    if (!htmlEntities.has(name)) {
        const node = document.createElement('p');
        node.innerHTML = entity;        // letters and digits only (see decodeEntities): never a tag
        htmlEntities.set(name, node.textContent);
    }
    return htmlEntities.get(name);
};
const decodeEntities = (value) => value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (entity, code) => {
    if (code[0] !== '#') return namedEntity(entity, code);
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
// A title left as the variable of its template ("Vidéo. $content.TitleNoTags", every video of the 9
// papers of EBRA, 70 news in 48 h on 5.10.2026; "{{title}}") is no title either
const MAX_TITLE_CHARS = 160;
const isTemplate = (title) => /\$\{?[a-z_]\w*\.\w|\{\{[^}]*\}\}/.test(title);
const withTitle = (item) => {
    if (isTemplate(item.title)) item = {...item, title: ''};
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

// A news sitemap (the list of its recent articles a site gives Google News, <url><news:news>) read as a
// feed: its title, its address, its date. A site with no feed often has one: 9 of 40 media the
// directory found without a feed (bench/news-sitemaps.mjs). The urls without <news:news> are pages,
// not news: left out
const fromSitemapUrl = (url) => {
    const news = url['news:news'];
    return {
        title: text(news['news:title']),
        thumbnail: url['image:image']?.[0]?.['image:loc'] ?? null,
        link: text(url.loc) || null,
        pubDate: news['news:publication_date'] ?? url.lastmod ?? null,
        description: '',
        category: news['news:keywords'] ? text(news['news:keywords']).split(/\s*,\s*/).filter(Boolean) : null,
    };
};

export const Parser = {
    // XML parsed made with 'fast-xml-parser', supports RSS 2.0, RDF (RSS 1.0) and Atom feeds, and the
    // news sitemaps
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
        if (data.urlset) {
            return [data.urlset.url ?? []].flat().filter(url => url?.['news:news']).map(fromSitemapUrl);
        }

        return [];
    },

    // a text decoded and without its HTML as the feeds give them (a title stored before a fix)
    Text: text,

}
