"use strict"

import process from 'node:process'
import 'dotenv/config';
import app from './app.js';

const port = process.env.PORT || 3000;

console.log("Listening on http://localhost:3001");
app.listen(port);