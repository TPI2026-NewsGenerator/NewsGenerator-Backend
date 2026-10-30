// Read only: the e-mail of the first cards of the last briefing of a profile (env PROFILE_ID, 7 by
// default) as the receiver gets it (/mail), with its link to the copy kept as sent, and that copy read
// through the real route (/api/mails/<token>). The copy is kept in memory, never in the database; no
// e-mail is sent. Port 3998
import express from 'express';
import {randomBytes} from 'node:crypto';
import {BriefingService} from '../services/briefing-service.js';
import {SentMailModel} from '../models/sent-mail-model.js';
import {briefingMail} from '../services/utils/briefing-mail.js';
import mailRouter from '../routes/mail-router.js';

const profileId = Number(process.env.PROFILE_ID ?? 7);
const copies = new Map();
Object.assign(SentMailModel, {
    save: async (copy) => { copies.set(copy.token, {...copy, created_at: new Date()}); return copies.size; },
    byToken: async (token) => copies.get(token) ?? null,
});

const briefing = await BriefingService.latest(profileId);
const sent = {...briefing, items: briefing.items.slice(0, 3)};
const token = randomBytes(18).toString('base64url');
const layout = {sender: 'mock'};
const mail = briefingMail(sent, {...layout, original: {url: `http://localhost:3998/api/mails/${token}`}});
await SentMailModel.save({token, subject: mail.subject,
    html: briefingMail(sent, {...layout, original: {sentAt: new Date().toISOString()}}).html});

const app = express();
app.get('/', (req, res) => res.redirect('/mail'));
app.get('/mail', (req, res) => res.type('html').send(mail.html));
app.use('/api/mails', mailRouter);
app.listen(3998, '127.0.0.1', () => console.log(`preview on 3998, copy ${token}`));
