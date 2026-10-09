//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: app.js
//  Description: Express entry point
//

"use strict"

import express from "express";
import cors from "cors";
import router from './routes/router.js'
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './config/swagger.js';
import {renewGate} from './services/utils/site-gate.js';


const app = express();
// served behind Caddy and the tunnel of Cloudflare (deploy/Caddyfile): the address of the reader is
// the one they forward, the limits of the login and the signup count per reader (see rate-limit.js)
app.set('trust proxy', 'loopback, uniquelocal');
// an e-mail of the briefing can carry the pictures of the reader (2 MB each, 6 MB in all, see
// mail-pictures.js), in base64: a third more. Every other request stays under 100 KB
app.use('/api/briefing/:id/email', express.json({limit: '9mb'}));
app.use(express.json());
app.use(cors());

// the password of the site, given once (see site-gate.js): renewed while the reader uses the site
app.use('/api', renewGate);

// API routes
app.use('/api', router);

// Swagger UI
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// basic health-check
app.get('/healthcheck', (req, res) => res.json({ status: 'ok' }));

// error handler (fallback)
app.use((err, req, res, next) => {
    console.error(err);
    if (!res.headersSent) {
        res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
    } else next(err);
});

export default app;