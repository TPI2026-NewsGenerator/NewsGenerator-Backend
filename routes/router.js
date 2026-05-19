import express from 'express';
import loginRouter from './login-router.js';
import newsRouter from './news-router.js';
import customSearchRouter from './customsearch-router.js';
import cors from "cors";

const router = express.Router();
router.use(express.json());
router.use(cors());

router.use('/login', loginRouter);
router.use('/news', newsRouter);
router.use('/customsearch', customSearchRouter);

export default router;