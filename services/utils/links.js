//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: links.js
//  Description: Filtering RSS links
//

"use strict"

import {rss} from "../../db/rss-links.js";

export const DEFAULT_LANGUAGE = 'en';

const Links = {
    // the languages the project has sources for
    languages() {
        return Object.keys(rss);
    },

    // the categories that can be searched in this language
    categories(language = DEFAULT_LANGUAGE) {
        return Object.keys(rss[language] ?? {});
    },

    // feeds of these categories, in this language only: a search never mixes two languages
    getCategoriesLinks(category, language = DEFAULT_LANGUAGE) {
        if (!category || category.length === 0) {
            throw "No categories selected, please select a category."
        }

        const sources = rss[language];
        if (!sources) {
            throw `No source in this language yet: ${language}. Available: ${Links.languages().join(', ')}`;
        }

        let newsLinks = [];
        let missingCategories = [];

        for (let c of category) {
            if (c.toLowerCase() in sources) {
                newsLinks = [...newsLinks, sources[c.toLowerCase()]];
            } else {
                missingCategories = [...missingCategories, c];
            }
        }

        if (newsLinks.length === 0 && missingCategories.length > 0) {
            throw `None of theses categories were found: ${missingCategories.join(', ')}`;
        }

        newsLinks = newsLinks.flat();

        return newsLinks;
    }
}

export default Links;
