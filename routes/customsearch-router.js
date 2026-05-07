import express from 'express'
import { body } from 'express-validator';
import {CustomSearchController} from "../controllers/customsearch-controller.js";

const router = express.Router();

const customSearchValidator = [
    body('user_id').isNumeric().withMessage('user_id must be a number'),
    body('password').isString().withMessage('password must be a string'),
];

router.post('', customSearchValidator, CustomSearchController.getUserCustomSearch);

export default router;