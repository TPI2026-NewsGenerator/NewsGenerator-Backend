//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: customsearch-router.js
//  Description: Router for custom searches feature
//

import express from 'express'
import { body } from 'express-validator';
import {CustomSearchController} from "../controllers/customsearch-controller.js";
import {authenticateToken} from "../services/utils/jwt.js";

const router = express.Router();

const customSearchValidator = [
    body('id').isNumeric().withMessage('id must be a number'),
    body('title').isString().withMessage('title must be a string'),
    body('keyword').isArray().withMessage('password must be an array'),
    body('language').isString().withMessage('language must be an string'),
    body('category').isArray().withMessage('category must be an array'),
];

router.get('', authenticateToken, customSearchValidator, CustomSearchController.getUserCustomSearch);
router.post('', authenticateToken, customSearchValidator, CustomSearchController.postUserCustomSearch);
router.delete('', authenticateToken, customSearchValidator, CustomSearchController.deleteUserCustomSearch);

export default router;