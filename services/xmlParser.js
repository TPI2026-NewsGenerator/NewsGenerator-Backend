import { XMLParser} from 'fast-xml-parser';

// XML parsed made with 'fast-xml-parser'
export const xmlParse = async (xml) => {
    const parser = new XMLParser();
    const data = parser.parse(xml);

    return data.rss?.channel?.item?.map(news => ({
        title: news.title ?? '',
        thumbnail: (news['media:thumbnail'] || news['media:content']) ?? null,
        link: news.link ?? null,
        pubDate: news.pubDate ?? null,
        description: news.description ?? '',
        category: news.category ?? null,
    }));
}