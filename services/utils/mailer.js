//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: mailer.js
//  Description: E-mails sent by the server, through an SMTP account (a Gmail address and one of its
//               app passwords)
//

"use strict"

import process from 'node:process';
import nodemailer from 'nodemailer';

// SMTP_USER and SMTP_PASS name the account (for Gmail: the address, and an app password made in the
// security settings of the account, never its own password). SMTP_HOST and SMTP_PORT default to Gmail;
// MAIL_FROM is the name and address the reader sees, the account by default. No account, no e-mail
const settings = () => ({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 465,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM || (process.env.SMTP_USER ? `NewsGenerator <${process.env.SMTP_USER}>` : null),
});

export const mailEnabled = () => Boolean(settings().user && settings().pass);

let transport = null;
const transportOf = () => {
    if (transport) return transport;
    const {host, port, user, pass} = settings();
    transport = nodemailer.createTransport({host, port, secure: port === 465, auth: {user, pass}});
    return transport;
};

// {to, subject, html, text}: sent, or an error the reader can read (the address of the account and
// the answer of the server stay in the logs)
export const sendMail = async ({to, subject, html, text}) => {
    if (!mailEnabled()) throw Object.assign(new Error('The server has no e-mail account to send it from.'), {status: 503});
    try {
        await transportOf().sendMail({from: settings().from, to, subject, html, text});
    } catch (err) {
        console.error(`Mail: not sent (${err.message})`);
        throw Object.assign(new Error('The e-mail could not be sent, try again later.'), {status: 502});
    }
};
