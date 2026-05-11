import express from 'express'
import { body } from 'express-validator';
import {CustomSearchController} from "../controllers/customsearch-controller.js";

const router = express.Router();

const customSearchValidator = [
    body('id').isNumeric().withMessage('id must be a number'),
    body('userId').isNumeric().withMessage('userId must be a number'),
    body('title').isString().withMessage('title must be a string'),
    body('keyword').isArray().withMessage('password must be an array'),
    body('language').isString().withMessage('language must be an string'),
    body('category').isArray().withMessage('category must be an array'),
];

router.post('', customSearchValidator, CustomSearchController.getUserCustomSearch);
router.get('', customSearchValidator, CustomSearchController.getUserCustomSearch);

export default router;