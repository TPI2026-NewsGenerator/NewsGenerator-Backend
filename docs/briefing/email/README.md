# Briefing > Email

An administrator sends cards of a briefing by e-mail, to their own address or to another one. In a bar
at the foot of the page they tick and order the cards, choose how their sentences are read (key passages,
key points or the summary), the AI version of a card's points or summary, the picture of each card,
their own title, the text of its key passages, points or summary as they write it (since 20.10.2026),
and take out the lines they do not want (a denial, an angle, an official source, a line
of the AI analysis). Since 05.11.2026 they also choose, card by card, which blocks go in: the badges (the media that
tell it, "Contested", "Officially confirmed", "Unconfirmed", each on its own), who it is about, the AI analysis, the angles,
the affair and the coverage (the countries and the pictures have their choice already), and see the e-mail as it will be
sent, live (see "The blocks" and "The preview"). The e-mail lays out what the briefing wrote, as the page shows it, all of it in the
reader's language: only its own words are translated when it is sent, once per language and kept
(`mail_labels`).
The cards sent count as read: their stories are left out of the next briefings for 48 hours.

## Where

- `client/src/pages/Briefing.jsx`: the box "Add to the e-mail" on each card (`BriefingCard.jsx`
  `onSelect`) and "tick them all", shown when `GET /api/briefing` answers `mail: true`.
- `client/src/features/briefing/components/MailBar.jsx`: the bar of the cards ticked, their order, the
  way of the sentences, the AI version, the sentences as the reader changes them (a point a line, a
  blank line between two paragraphs of a summary or of key passages; ticking the AI version starts again
  from it), the address (the account's written in); `MailAside.jsx`: the
  analysis lines, denials, angles and official sources kept or taken out; `MailPicture.jsx` and
  `mailPictures.js`: the picture of a card, measured by the browser.
- API: `GET /api/briefing/:id/stories/:storyId/pictures`, `POST /api/briefing/:id/stories/:storyId/neutral-title`,
  `POST /api/briefing/:id/email` (204), `POST /api/briefing/:id/email/preview` (200 `{html}`), all
  for the administrators (`adminOnly(MAIL_REFUSED)`, 403); `GET /api/mails/:token` (no account), the copy
  of an e-mail sent before 13.10.2026.

## How it works

- `BriefingController.latest` answers `mail: mailEnabled() && isAdmin(user)`: the server has an SMTP
  account (`SMTP_USER`, `SMTP_PASS`, `services/utils/mailer.js`) and the reader the role `Admin`.
- The news of the names followed can be put in the e-mail from their tab (the user, 03.11.2026): each one has
  a button "Add to the e-mail" that adds it like a news added by its link (`POST /api/briefing/:id/news`, see
  [news by link](../news-by-link/README.md): made a card by the steps of a briefing, with its story, the media that tell it, its angles, sources and analysis since 03.11.2026), or, when a card of the
  briefing already tells it, "Tick it for the e-mail" (`client/src/features/briefing/mailAdd.js`). Only for a
  reader who can send e-mails, in the tab "What you follow" of the page of the briefing (not on the page of a club or
  a person), and only when a briefing is written: the tab says so. The bar to send the e-mail shows in that tab as in
  the one of the briefing, as soon as a story is ticked (the user, 03.11.2026: it showed nothing after the click).
- The title of a card is changed by default (its bait taken out, or rewritten by the AI): the editor shows the title as the medium
  wrote it (`item.titleAsPublished`, in its language when the card is translated: it is not translated) with "Use the title as
  published" (the user, 03.11.2026). The title can also be changed by hand, and the AI can propose a neutral one ("Suggest a neutral title",
  `MailNeutralTitle.jsx`, `POST /api/briefing/:id/stories/:storyId/neutral-title`): shown against the title word by word,
  used or kept by the reader, see [neutral titles](../README.md#a-neutral-title-on-demand).
- The countries of a card are chosen in the editor of the e-mail: the ones found ticked or not, and any other country of
  the world found by typing a few letters of its name (accents and case aside; Enter takes the first).
- The pictures of a card (`BriefingService.pictures`, `services/utils/mail-pictures.js` `storyPictures`):
  the card's own first, then the ones measured when it was written (`item.pictures`, since 29.10.2026: the
  page and feed pictures of all its articles that load), then the thumbnails the feeds gave its story's articles
  (`BriefingModel.articlePictures`, 30 at most). The browser measures them (`mailPictures.js`): one under 560 px wide (`MIN_PICTURE_WIDTH`,
  the width of the picture in the e-mail) is put aside, a card whose own is too small gets the best other
  of its story, else none.
- `POST /api/briefing/:id/email {storyIds, to, pictures, titles, removed, format, ai, texts, countries, theme,
  timeZone, blocks}`: 10 an hour per
  IP address and 30 a day per account (`rateLimit`); the body up to 9 MB (`app.js`), for the reader's files in
  base64.
- **The blocks** (`blocks: {storyId: {media, contested, official, unconfirmed, names, analysis, angles, affair, coverage}}`,
  booleans, `withBlocks` in `briefing-service.js`; 400 for anything else): for a card with an entry the e-mail has a
  **badges row** under its title (client `BriefingCard.jsx` `Glance`: a grey pill "Told by 12 media in 5 languages", then
  "Contested" and "Unconfirmed" in orange, "Officially confirmed" in green, the tints mixed to plain colours because mail apps do
  not all read `rgba()`), the **names** (a pill each, `item.names`), its **affair** and its **coverage**, in that order after the
  angles, before where to read it. An entry that does not say a block has what the page shows at first: `media`, `names`,
  `affair` and `coverage` off, `contested`, `official`, `unconfirmed`, `analysis` and `angles` on. A block at false takes
  its data from the card (the denials, the official posts, the "not confirmed" words, the analysis, the angles), so the box and
  the badge go together; the lines taken out (`removed`) apply on top. A card with no entry, or no `blocks`, is sent as it
  was before: no badge, no names, no coverage, no affair. A badge is there when its block is on and the card has what it says.
- **What the editor opens with** (client, `mailBlocks` preference, 10.11.2026): the editor opened with fixed blocks (`DEFAULT_BLOCKS`: everything
  but the affair and its coverage) whatever the reader ticked in the settings, which only counted when they clicked a preset in the editor (a friend of
  the user ticked "Told by" off in the settings and found it on in every e-mail). The three presets ("Short", "Standard", "Everything") are gone, a friend
  of the user uses a single mode: the settings have ONE list of blocks for the e-mail, and the editor opens with it, put on for every story that has the
  blocks, off for the others (`startingChoices` of `mailBlocks.js`, in `open` of `useMailDraft.js`). Until the reader ticks anything, the list is what
  they had set for the presets (the preset they had changed, "Everything" first), else what the editor always opened with. They can still change a block for all the
  stories, or for one, in the editor. Kept on the account, so it is the same on every profile and device. The page has its own list (`pageBlocks`), for the
  cards.
- The **coverage** (`coverageOfCard`, `services/utils/card-coverage.js`, the same count as the page's
  `cardCoverage.js`): how many media and languages, who told it first, the hours as bars (a table cell each, the one thing every
  mail app draws, 12 bars at most), the languages. The **affair** (`AffairService.forMail`: the view the page's tab shows and the
  size of its thread, built by the AI the first time, 20 seconds or so, kept 3 hours; the page builds them in advance): its title,
  its figures, then its key events one under the other, the oldest first, each with a dot (blue; orange when someone denies it,
  green when a party announced it itself, a denial first; hollow and dashed when the articles say it is not confirmed), its date,
  its title (translated) as a link, the medium, how many media told it and its marks; a line counts the events that are not key
  ("+ 4 smaller events"). The line of the page cannot be drawn in an e-mail. A card that is no affair, or whose affair cannot be
  built, is sent without it (logged).
- **The preview**: `POST /api/briefing/:id/email/preview`, the same body as `/email` (`to` optional: it only decides whether
  the e-mail goes to another than the reader, who has no "why" of the cards then; a wrong one is left out, the reader is still
  typing it), answers `{html}` and sends nothing nor marks any story as read. `BriefingService.email` and `.preview` build the
  e-mail with the same function (`builtMail`), so the preview is the e-mail: the files the reader joined (`cid:`) are put in the
  page as `data:`, and `<base target="_blank">` opens its links in a tab (`previewHtml`). 200 in 10 minutes per account
  (`rateLimit`): the editor asks at each change. The AI is not asked again at each one: the labels of a language are translated
  once and kept while the server runs (a request in progress is waited for), and so are the words of an article saying it has no
  confirmation (`withHedgedTranslated`, 500 kept); the affairs are kept by `AffairService`.
- `BriefingService.email`: `storyIds` one at least, `format` one of `MAIL_FORMATS` (`points`, `digest`,
  `passages`, the key passages when not given), `ai` the cards sent in their AI version, `to` an address
  (`isEmail`) or the account's; 400 otherwise. A ready briefing of this reader, else 404.
- Each card with its AI analysis when it is ready (`briefings.analysis`), in the order given, once each;
  `withOwnTitles` (300 characters at most), `withBlocks`, `withOwnTexts` (`texts: {storyId: [paragraph]}`, 20
  paragraphs of 2,000 characters at most, sent instead of the article's sentences and of the AI version
  in the way chosen; left empty, the card's own), `withoutTakenOut` (`removed: {storyId: {contested, angles, names,
  official, why, next, timeline: [index]}}`; an analysis left empty is not sent), `withChosenPictures`
  (taken out, an address of the web checked by `assertPublicUrl`, or a JPEG, PNG, GIF or WebP file told by
  its first bytes, 2 MB each, 6 MB per e-mail, joined as `cid:`), then `withAffairs` (the affair of the cards that ask for it).
- Sent to another address than the account's: the "why" of each card is left out (it is written to the
  reader) and the answers go to the reader (`Reply-To`).
- `briefingMail` (`services/utils/briefing-mail.js`): a table with inline styles in the design of the page
  (Inter, white and one grey, blue links, rounded boxes), light unless the sender chooses dark (`theme`, a
  switch in the bar, fixed whatever the system of who reads it), its hours in the time zone of the sender's
  browser (`timeZone`, Zurich without one); per card its number, countries (the ones the sender chose in the
  bar, `withOwnCountries`, `countries: {storyId: [code]}`, 10 at most; else the ones found, none when the title
  names them; not its topic: the
  same card after card, the user, 18.10.2026), date and language,
  title, its badges and who it is about when asked, why, picture, its sentences in the way chosen (or the AI's, without saying so), its official
  sources boxed right under them, its analysis, denials, angles, its affair and its coverage when asked, where to read it, and the notes of its
  margin. No "Who tells it" (the badge of the media is the reader's choice), nothing says what is translated. Titled with the profile's name and the day
  ("Roberto’s Briefing · 13 October 2026"), the subject adds the number of stories.
- In the reader's language (`readerLanguage` of the profile, `services/utils/mail-labels.js`): `labelsFor`
  translates `LABELS` (`briefing-mail.js`, "Key points", "Contested", "{by} denies:"...) with
  `translateTexts`, once per word and language: the translation is kept in `mail_labels`
  (`MailLabelModel`, `db/add_mail_labels.sql`), so the e-mail says the same words from one session of the
  server to the next, the AI is asked only for the words with none kept, and a translation kept is never
  replaced (one corrected by hand stays); a translation that lost a `{place}` keeps its English and is not
  kept (the words of the blocks too, since 05.11.2026: translated once, at the first e-mail or preview in a language). The database not answering, the AI translates them all. The AI not answering, the e-mail is in English, its dates too. `withHedgedTranslated`
  translates the words of an article saying it has no confirmation ("selon nos informations"). Dates
  and names of languages in that language (`Intl`). Written by the briefing since 18.10.2026: who denies
  in that language (`contested.js`), the titles of the official posts translated (`official-sources.js`).
- The picture of a card (`pictureOf`): the first sharp one of its articles' pictures (since 29.10.2026, see
  [Briefing](../README.md)), the one its article's page gives to be shared (`og:image`) before the one its feed
  gave (since 18.10.2026); a site's picture for pages without one ("default",
  "placeholder", "logo" in its address) is never taken (`crawlers.js` `pageImage`).
- The illustration of a card (`services/utils/illustrations.js`, since 18.10.2026): the picture Wikimedia
  Commons has (Wikidata P18, `readPictures`) of the person most of its articles name (`item.names`), else
  of the organisation, 560 px wide at least, a photograph (no `.svg`), asked at 1280 px. It is the
  card's picture only when none of its articles gives one, last in the pictures of the story
  (`storyPictures`, `illustration: true`), and taken by the e-mail (`bestPicture`, client) only when no
  picture of its articles is sharp. Captioned "Illustration — Wikimedia Commons · author, licence";
  a standing one is at most 420 px high in the e-mail (narrower).
- **A picture in portrait mode** (a friend of the user, 10.11.2026: "une photo en mode portrait, est-ce possible de la couper en paysage ou d'en
  prendre une autre ?", the standing portrait of Infantino of Commons in an e-mail). Measured on 733 cards of 21 days (`bench/portrait-count.mjs`): 9 show an
  illustration of Commons, 6 of the 466 whose picture size is known (1.3%) stand, 2 of those 6 have a wide picture among their other articles'. Three
  things, all of a standing picture (`isStanding`, `picture-sizes.js`: wider than 0.9 times its height is not): (1) `pictureOf` takes a wide picture
  before a standing one of the same sharpness (the sharpness first: a small wide one does not beat a sharp standing one); (2) the AI choice (see
  [the picture chosen by the AI](README.md)) puts a wide picture in place of a standing one when it rates it as good (the margin of one point is zero),
  and a standing one in place of a wide one only for two points (`wideForStanding`); (3) the e-mail shows a standing picture of any article, not only an
  illustration, at most 420 px high (the size is the one the card was written with, `pictures`; a card of before the sizes, a file of the reader keep
  560 px). The page cuts a standing picture to its 16:9 landscape at 12% of its height (`object-[50%_12%]`, the size read when it loads): 25%, the
  rule of the illustrations, cut the top of the head of the Commons portrait of Infantino, 12% shows the whole head. **Not done**: cutting the picture in
  the e-mail (an Outlook that does not know the crop shows the whole of it, or stretches it, and no image library is installed to cut the file), nor another
  photograph from the Commons category of the person: the category of Infantino holds 22 landscape photographs of 1 200 px or more, ceremonies and visits
  where he is a small figure among others (a medal ceremony of the Winter Youth Olympics), and telling the person from a crowd would be a recognition of
  a face by the AI, which is not asked.
- `sendMail` (nodemailer, Gmail by default): no account 503, refused by the SMTP server 502 (its answer
  in the logs). Then `BriefingModel.markSent` writes `sentAt` on each card sent; the next briefings leave
  their stories out for 48 hours (`repeats.js`); a failure there is only logged.
- No copy is kept since 13.10.2026. The links of the e-mails sent before still open theirs:
  `GET /api/mails/:token` (a token of 24 letters, digits, `-` or `_`), 60 reads in 15 minutes per IP address,
  a page with a `Content-Security-Policy` without scripts, `sandbox`, not framed nor indexed (`sent_mails`).

## Measured

- 49 of the 289 pictures of 6 briefings were narrower than 560 px, some 72 px (`bench/picture-sizes.mjs`,
  [the former README](../../archive/readme-features-2026-10-24.md) "The e-mail"); hence the measure in the browser.
- 18.10.2026, 142 cards of 12 briefings: the `og:image` of the lead's page is its picture already for 69,
  wider than its feed's for 35, narrower for 17 (both sharp); with it first, 116 cards have one of 560 px or
  more instead of 98. Of 122 cards, 8 had no sharp picture in the gallery: 6 have one in a page's `og:image`.
- 18.10.2026, 200 cards of 12 briefings: 102 name someone Wikidata knows, 92 have a picture there, 86 one of
  560 px or more. A person is the one of the news (Infantino, Wenger, Motsepe), an organisation its
  building (the seat of UEFA, the Googleplex). Live on 47 cards: 26 illustrations in 1.6 s, all loading.
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
- [Affair](../affair/README.md): the events and the coverage of an affair, the block "This affair" of the e-mail
- [Analysis (IA)](../analysis-ia/README.md), [Official source](../official-source/README.md),
  [Other angles](../other-angles/README.md), [Denials](../denials/README.md): the lines the reader keeps
  or takes out
- [Key passages](../key-passages/README.md), [Bullet points](../bullet-points/README.md),
  [Summary](../summary/README.md): the ways the sentences are sent in
