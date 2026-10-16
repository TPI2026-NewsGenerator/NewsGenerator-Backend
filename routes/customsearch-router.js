//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: customsearch-router.js
//  Description: Router for custom searches feature
//

import express from 'express'
import {CustomSearchController} from "../controllers/customsearch-controller.js";
import {authenticateToken} from "../services/utils/jwt.js";

const router = express.Router();

// the fields are checked by the controller
router.get('', authenticateToken, CustomSearchController.getUserCustomSearch);
router.post('', authenticateToken, CustomSearchController.postUserCustomSearch);
router.delete('', authenticateToken, CustomSearchController.deleteUserCustomSearch);

export default router;