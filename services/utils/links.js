//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: links.js
//  Description: Filtering RSS links
//

"use strict"

import {rss} from "../../db/rss-links.js";

const Links = {
    getCategoriesLinks(category) {
        if (!category || category.length === 0) {
            throw "No categories selected, please select a category."
        }
        let newsLinks = [];
        let missingCategories = [];

        for (let c of category) {
            if (c.toLowerCase() in rss.en) {
                newsLinks = [...newsLinks, rss.en[c.toLowerCase()]];
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