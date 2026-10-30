// A local API with the password of the site only (services/utils/site-gate.js), its password and its
// secret made up here, never the ones of the site: to try the Caddyfile in Docker before deploying it.
// /api/ping stands for the rest of the API. Port 3998
//   node bench/gate-mock-api.mjs
import process from 'node:process';
import express from 'express';
import bcrypt from 'bcrypt';

process.env.ACCESS_TOKEN_SECRET = 'a secret of the test only, never the one of the site';
process.env.SITE_PASSWORD_HASH = await bcrypt.hash('test-password', 4);
const {renewGate} = await import('../services/utils/site-gate.js');
const {default: gateRouter} = await import('../routes/gate-router.js');

const app = express();
app.set('trust proxy', 'loopback, uniquelocal');
app.use('/api', (req, res, next) => { console.log(`${req.method} ${req.originalUrl} ${req.get('X-Forwarded-Uri') ?? ''}`); next(); });
app.use('/api', renewGate);
app.use('/api/gate', gateRouter);
app.get('/api/ping', (req, res) => res.json({ok: true}));
app.listen(3998, '0.0.0.0', () => console.log('gate API on 3998'));
