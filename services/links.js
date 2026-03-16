import {rss} from "../db/rss_links.js";

const Links = {
    getCategoriesLinks(categories) {
        let newsLinks = [];
        let missingCategories = [];

        for (let category of categories) {
            if (category in rss.en) {
                newsLinks.push(rss.en[category.toLowerCase()]);
            } else {
                missingCategories.push(category);
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