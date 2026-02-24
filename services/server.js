import express from 'express';
import cors from 'cors';
import {scrapNews} from "./scraper.js";
import {rss} from './../db/rss_links.js'

const app = express();
app.use(express.json());
app.use(cors());

app.post('/api/news', async (req, res) => {
    const {query} = req.body;

    try {
        let newsLinks = [];

        for (let category of query.category) {
            newsLinks.push(rss.en[category.toLowerCase()])
        }

        newsLinks = newsLinks.flat();

        // Get news
        const feed = await scrapNews(query.keywords, newsLinks);

        res.json(feed);
    } catch (err) {
        res.status(500).json({error: err.message});
    }
});


console.log("Listening on http://localhost:3001");
app.listen(3001);