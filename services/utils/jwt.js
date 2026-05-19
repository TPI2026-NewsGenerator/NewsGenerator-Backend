//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: jwt.js
//  Description: JSONWebToken generation and verification
//

import process from 'node:process'
import 'dotenv/config';
import jwt from 'jsonwebtoken'


export const generateAccessToken = (user) => {
    return jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {expiresIn: '1h'});
}

export const authenticateToken = (req, res, next) => {
    const authHeader = req.get('Authorization')
    const token = authHeader && authHeader.split(' ')[1];

    try {
        req.user = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
        next(); // Continue to the next middleware or route
    } catch (e) {
        return res.status(403).json({
            error: 'Forbidden, invalid or expired token... Please try to log in',
        });
    }
};