import express from 'express';
import newsRouter from './news-router.js';
import loginRouter from './login-router.js';
import cors from "cors";

const router = express.Router();
router.use(express.json());
router.use(cors());

router.use('/news', newsRouter);
router.use('/login', loginRouter);

export default router;