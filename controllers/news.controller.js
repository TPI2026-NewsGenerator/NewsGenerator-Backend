import NewsService from '../services/news.service.js';

const News = {
    async fetch(req, res) {
        try {
            const customer = await NewsService.fetch(req.body);
            res.status(200).json(customer);
        } catch (error) {
            if (error.includes("None of theses categories were found:")) {
                res.status(400).json({error: error});
            } else {
                res.status(500).json({error: error});
            }
        }
    },

}

export default News;