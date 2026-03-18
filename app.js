"use strict"

import express from "express";
import cors from "cors";
import router from './routes/router.js'
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './config/swagger.js';


const app = express();
app.use(express.json());
app.use(cors());

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