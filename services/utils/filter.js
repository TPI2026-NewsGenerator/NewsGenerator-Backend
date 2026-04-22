"use strict"

export const Filter = {
    // filter news on category and title
    News: (newsList, keywords) => {
        let filteredNews = [];
        if (keywords[0] && keywords[0].trim() !== ''){
            for (let news of newsList) {
                // check if category corresponds
                if (!news || !news.category) continue;
                for (let keyword of keywords) {
                    // Check filter in category array
                    if (Array.isArray(news.category)) {
                        for (let category of (news?.category["#text"] || news?.category) ?? []) {
                            if (typeof category === 'string' && category?.toLowerCase().includes(keyword.toLowerCase())) {
                                filteredNews.push(news);
                            }
                        }
                        // Check filter in category word (if only 1 category)
                    } else if (news.category.toLowerCase().includes(keyword.toLowerCase())) {
                        filteredNews.push(news);
                    }

                    // // Check filter in description
                    // if (news.description.toLowerCase().includes(keyword.toLowerCase())) {
                    //     filteredNews.push(news);
                    // }
                    // Check filter in title
                    if (news.title.toLowerCase().includes(keyword.toLowerCase()) && !filteredNews.includes(news)) {
                        filteredNews.push(news);
                    }
                }
            }
        }

        return filteredNews;
    }
}