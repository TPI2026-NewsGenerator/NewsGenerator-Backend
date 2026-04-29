import express from 'express'
import { body } from 'express-validator';
import {NewsController} from '../controllers/news-controller.js';
import {authenticateToken} from "../services/utils/jwt.js";

const router = express.Router();

const fetchNewsValidator = [
    body('category').isArray().withMessage('categories must be an array'),
    body('keywords').isArray().withMessage('keywords must be an array'),
    body('undesiredTopics').isArray().withMessage('undesiredTopics must be an array'),
    body('language').isString().withMessage('language must be a string'),
    body('timeframe').isObject().withMessage('timeframe must be an object with properties "start" and "end"'),
];

router.post('', authenticateToken, fetchNewsValidator, NewsController.getNews);

export default router;