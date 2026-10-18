# Briefing > Email

An administrator sends cards of a briefing by e-mail, to their own address or to another one. In a bar
at the foot of the page they tick and order the cards, choose how their sentences are read (key passages,
key points or the summary), the AI version of a card's points or summary, the picture of each card,
their own title, and take out the lines they do not want (a denial, an angle, an official source, a line
of the AI analysis). The e-mail lays out what the briefing wrote, as the page shows it, all of it in the
reader's language: only its own words are translated when it is sent, once per language.
The cards sent count as read: their stories are left out of the next briefings for 48 hours.

## Where

- `client/src/pages/Briefing.jsx`: the box "Add to the e-mail" on each card (`BriefingCard.jsx`
  `onSelect`) and "tick them all", shown when `GET /api/briefing` answers `mail: true`.
- `client/src/features/briefing/components/MailBar.jsx`: the bar of the cards ticked, their order, the
  way of the sentences, the AI version, the address (the account's written in); `MailAside.jsx`: the
  analysis lines, denials, angles and official sources kept or taken out; `MailPicture.jsx` and
  `mailPictures.js`: the picture of a card, measured by the browser.
- API: `GET /api/briefing/:id/stories/:storyId/pictures`, `POST /api/briefing/:id/email` (204), both
  for the administrators (`adminOnly(MAIL_REFUSED)`, 403); `GET /api/mails/:token` (no account), the copy
  of an e-mail sent before 13.10.2026.

## How it works

- `BriefingController.latest` answers `mail: mailEnabled() && isAdmin(user)`: the server has an SMTP
  account (`SMTP_USER`, `SMTP_PASS`, `services/utils/mailer.js`) and the reader the role `Admin`.
- The pictures of a card (`BriefingService.pictures`, `services/utils/mail-pictures.js` `storyPictures`):
  the card's own first, then the thumbnails the feeds gave its story's articles (`BriefingModel.articlePictures`,
  30 at most). The browser measures them (`mailPictures.js`): one under 560 px wide (`MIN_PICTURE_WIDTH`,
  the width of the picture in the e-mail) is put aside, a card whose own is too small gets the best other
  of its story, else none.
- `POST /api/briefing/:id/email {storyIds, to, pictures, titles, removed, format, ai}`: 10 an hour per
  IP address and 30 a day per account (`rateLimit`); the body up to 9 MB (`app.js`), for the reader's files in
  base64.
- `BriefingService.email`: `storyIds` one at least, `format` one of `MAIL_FORMATS` (`points`, `digest`,
  `passages`, the key passages when not given), `ai` the cards sent in their AI version, `to` an address
  (`isEmail`) or the account's; 400 otherwise. A ready briefing of this reader, else 404.
- Each card with its AI analysis when it is ready (`briefings.analysis`), in the order given, once each;
  `withOwnTitles` (300 characters at most), `withoutTakenOut` (`removed: {storyId: {contested, angles,
  official, why, next, timeline: [index]}}`; an analysis left empty is not sent), `withChosenPictures`
  (taken out, an address of the web checked by `assertPublicUrl`, or a JPEG, PNG, GIF or WebP file told by
  its first bytes, 2 MB each, 6 MB per e-mail, joined as `cid:`).
- Sent to another address than the account's: the "why" of each card is left out (it is written to the
  reader) and the answers go to the reader (`Reply-To`).
- `briefingMail` (`services/utils/briefing-mail.js`): a table with inline styles, the colours and fonts of
  the page, dark where the mail app follows the system; per card its number, topic, date and language,
  title, why, picture, its sentences in the way chosen (or the AI's, without saying so), its official
  sources boxed right under them, its analysis, denials, angles, where to read it, and the notes of its
  margin. No "Who tells it", nothing says what is translated. Titled with the profile's name and the day
  ("Roberto’s Briefing · 13 October 2026"), the subject adds the number of stories.
- In the reader's language (`readerLanguage` of the profile, `services/utils/mail-labels.js`): `labelsFor`
  translates `LABELS` (`briefing-mail.js`, "Key points", "Contested", "{by} denies:"...) with
  `translateTexts`, once per language while the server runs; a translation that lost a `{place}` keeps
  its English. The AI not answering, the e-mail is in English, its dates too. `withHedgedTranslated`
  translates the words of an article saying it has no confirmation ("selon nos informations"). Dates
  and names of languages in that language (`Intl`). Written by the briefing since 18.10.2026: who denies
  in that language (`contested.js`), the titles of the official posts translated (`official-sources.js`).
- The picture of a card (`pictureOf`): the one its article's page gives to be shared (`og:image`) first,
  the one its feed gave after (since 18.10.2026); a site's picture for pages without one ("default",
  "placeholder", "logo" in its address) is never taken (`crawlers.js` `pageImage`).
- `sendMail` (nodemailer, Gmail by default): no account 503, refused by the SMTP server 502 (its answer
  in the logs). Then `BriefingModel.markSent` writes `sentAt` on each card sent; the next briefings leave
  their stories out for 48 hours (`repeats.js`); a failure there is only logged.
- No copy is kept since 13.10.2026. The links of the e-mails sent before still open theirs:
  `GET /api/mails/:token` (a token of 24 letters, digits, `-` or `_`), 60 reads in 15 minutes per IP address,
  a page with a `Content-Security-Policy` without scripts, `sandbox`, not framed nor indexed (`sent_mails`).

## Measured

- 49 of the 289 pictures of 6 briefings were narrower than 560 px, some 72 px (`bench/picture-sizes.mjs`,
  server/README.md "The e-mail"); hence the measure in the browser.
- 18.10.2026, 142 cards of 12 briefings: the `og:image` of the lead's page is its picture already for 69,
  wider than its feed's for 35, narrower for 17 (both sharp); with it first, 116 cards have one of 560 px or
  more instead of 98. Of 122 cards, 8 had no sharp picture in the gallery: 6 have one in a page's `og:image`.
- The account of the server is a Gmail one, which Gmail limits to 500 e-mails a day (comment of
  `routes/briefing-router.js`): hence 10 an hour and 30 a day.

## Diagrams

- [09-email](09-email.png) ([source](09-email.puml)): class diagram, the routes, the guards, the
  service, the writing of the e-mail and the models
- [26-email-sequence](26-email-sequence.png) ([source](26-email-sequence.puml)): the mail bar, the
  pictures route, the sending, and the copy of an e-mail sent before
- The client (client repository): [client-05-email](../../../../client/docs/briefing/email/client-05-email.png),
  [client-21-email-sequence](../../../../client/docs/briefing/email/client-21-email-sequence.png)
- The briefing: [08-briefing](../08-briefing.png), [22-briefing-sequence](../22-briefing-sequence.png)

## See also

- [News by link](../news-by-link/README.md): a news added to the briefing to send it
- [Analysis (IA)](../analysis-ia/README.md), [Official source](../official-source/README.md),
  [Other angles](../other-angles/README.md), [Denials](../denials/README.md): the lines the reader keeps
  or takes out
- [Key passages](../key-passages/README.md), [Bullet points](../bullet-points/README.md),
  [Summary](../summary/README.md): the ways the sentences are sent in
