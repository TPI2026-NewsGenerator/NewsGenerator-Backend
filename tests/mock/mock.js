import express from "express";
import cors from "cors";
import {rss_feed} from './rss_feed.js'


const app = express();
app.use(express.json());
app.use(cors());

app.get('/api/mock', async (req, res) => {
    try {
        res.status(200).json(rss_feed);
    } catch (err) {
        res.status(500).json({error: err.message});
    }
});


console.log("Listening on http://localhost:3002");
app.listen(3002);