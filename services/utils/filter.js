//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: filter.js
//  Description: News filtering system
//

"use strict"

export const Filter = {
    // filter news on category and title
    News: (newsList, keywords) => {
        let filteredNews = [];
        if (keywords[0] && keywords[0].trim() !== ''){
            for (let news of newsList) {
                // check if category
                if (!news || !news.category || news.category === "") continue;

                for (let keyword of keywords) {
                    // Check filter in category if array
                    if (Array.isArray(news.category)) {
                        for (let category of (news?.category["#text"] || news?.category) ?? []) {
                            if (typeof category === 'object' && category["#text"].toLowerCase().includes(keyword.toLowerCase())){
                                filteredNews.push(news);
                            }
                            else if (typeof category === 'string' && category?.toLowerCase().includes(keyword.toLowerCase())) {
                                filteredNews.push(news);
                            }
                        }
                        // Check filter in category if object
                    } else if (typeof news.category === 'object' && news.category["#text"]) {
                        if (news.category["#text"].toLowerCase().includes(keyword.toLowerCase())) {
                            filteredNews.push(news);
                        }
                        // Check filter in category if string
                    } else if (typeof news.category === 'string' && news.category.toLowerCase().includes(keyword.toLowerCase())) {
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