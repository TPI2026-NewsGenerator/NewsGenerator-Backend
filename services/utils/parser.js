"use strict"

import {XMLParser} from 'fast-xml-parser';

export const Parser = {
    // XML parsed made with 'fast-xml-parser'
    Xml: async (xml) => {
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: ""
        });
        const data = parser.parse(xml);


        return data.rss?.channel?.item?.map(news => {
            const thumbnails = news['media:thumbnail'] || news['media:content'] || [];
            const thumbUrl = Array.isArray(thumbnails)
                ? thumbnails[thumbnails.length - 1]?.url
                : thumbnails?.url;

            return {
                title: news.title ?? '',
                thumbnail: thumbUrl ?? null,
                link: news.link ?? null,
                pubDate: news.pubDate ?? null,
                description: news.description ?? '',
                category: news.category ?? null,
            }
        });
    }

}
