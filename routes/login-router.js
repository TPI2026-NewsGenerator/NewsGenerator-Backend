import express from 'express'
import { body } from 'express-validator';
import {LoginController} from "../controllers/login-controller.js";

const router = express.Router();

// const fetchLoginValidator = [
//     body('email').isString().withMessage('email must be a string'),
//     body('username').isString().withMessage('username must be a string'),
//     body('password').isString().withMessage('password must be a string'),
// ];

// router.post('', fetchLoginValidator, LoginController.authUser);
router.post('', await LoginController.authUser);

export default router;