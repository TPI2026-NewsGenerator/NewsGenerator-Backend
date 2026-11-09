# Briefing > News by link

An administrator can add to a ready briefing a news the briefing did not choose, by pasting its link or from the
tab "What you follow": the server makes it a card **by the steps of a briefing** (the user, 03.11.2026: "ajoute le process
complet de briefing", `completeCards`, the same function the briefing is written with), and the news comes last in the
briefing, marked "Added by you" and ticked for the e-mail. It is meant to be sent with the other cards. It has no
thumb and no "why" (it was not chosen by the AI). It can be taken out again.

What it goes through, as a card of the briefing does: its page read with the other media that tell it, the key passages, the
points and the summary chosen and translated, the AI version, the denials its articles report, its title made neutral
(the code takes a teaser out, the AI rewrites a judgment when a second opinion says it tells the same fact), the other angles
of the affair, the official sources of its parties, the people and organisations it names with their countries, its pictures and
the Commons illustration, the words of non-confirmation translated, and its analysis ("What changed", "Why this matters",
"What breaks next"), written after the answer. Only the review against what the reader refuses is skipped: they chose it.

When we hold the news already (every news of the tab "What you follow" is one, and the pages of the media we read), it is
read **with its story**: the lead of the card is the news added, and the other media of the story tell it with it ("Told by 13
media"), which is also what the other angles, the people named and the analysis are made from. A page of another site is a story of
its own page: no other media, no angle, no name stored for it, the rest as above (measured on the real base 03.11.2026: a news
of ESPN with a story of 13 media, 72 s, 18 articles, names, countries, an angle, an official source, 9 pictures; the same page at
an address we do not hold, 75 s, without the media, names and angles).

A link of a news that **another briefing of the same reader** has (a profile of theirs, written in the last 7
days) is not read again: its card is copied as that briefing shows it, with its other angles, denials,
official sources, countries, names, pictures, AI version and the analysis lines written for it ("What
changed", "Why this matters", "What breaks next"). The reader pastes the link of a card they saw on another
profile (30.10.2026: copied by its link, the card came without its angles, sources and analysis).

## Where

- `client/src/features/briefing/components/AddNews.jsx`: "Add a news by its link", in the column of the
  page `client/src/pages/Briefing.jsx`, shown only when `GET /api/briefing` answers `mail: true` (the
  server has an SMTP account and the reader is an administrator). `addNews()` appends the card and ticks
  it; `BriefingCard.jsx` shows "Added by you" and "Take it out" (`onRemove`).
- API: `POST /api/briefing/:id/news {url}` (201 `{item, analysis, analyzing}`), `DELETE /api/briefing/:id/news/:storyId`
  (204), both after `authenticateToken` and `adminOnly(MAIL_REFUSED)` (403 for the others); the POST 30
  an hour per reader (`rateLimit`, 429).

## How it works

- `BriefingService.importNews` (`services/briefing-service.js`): the address 2000 characters at most
  (`MAX_URL`) and public (`assertPublicUrl`, `services/utils/public-url.js`: http(s), every IP of the name
  public; else 400); a ready briefing of this reader (`readyBriefing`, else 404).
- Refused: a link already the lead or an article of a card (409; for a card copied from another briefing, any
  of its articles), and an 11th news (`MAX_IMPORTED` = 10
  per briefing, 400); checked before the page is read, and again by the statement that adds it (see
  `addItem` below).
- Before the page is read, `cardElsewhere` asks `BriefingModel.cardOfLinks` for a card of another ready briefing
  of this reader (`id_user`, the last `TRANSFER_DAYS` = 7 days, the address with or without its last slash, as
  lead or article; a card of a story before one added, then the newest briefing). It is used when the profile
  that briefing was written for reads in the same language as this one (`readerLanguage`: its translations are
  of that language), else the page is read as below. `transferredCard` keeps the card and leaves out what was
  for the other profile only: its `storyId`, why chosen, interest, project, follow-up, thumb, the mark of an
  e-mail sent, the feeds; it is `imported` and `transferred` (the page says "Copied from another of your
  briefings"). No call of the AI.
- Its analysis lines (`briefings.analysis.cards[storyId]`, `{why, next, timeline}`) go with it:
  `BriefingModel.addAnalysisLines` saves them under its new id, in one statement, only when this briefing's
  analysis is `ready` (a running one is saved whole again by the server writing it, and would lose them: the
  card comes without them then). The answer is `{item, analysis}`, `analysis` the lines or `null`; the page
  puts them with the others. `BriefingModel.removeItem` takes them out with the card (the next news added
  gets the same negative id).
- `importedCardOf` (`briefing-service.js`): the news is looked for in our own (`StoryModel.articlesOfLinks`, the address
  as given, without its tracking parameters `utm_*`, `fbclid`..., with or without its last slash, as the link of a feed or the real
  address of one of Google News). Found in a story: the articles of that story over `IMPORT_DAYS` = 7 days in the feeds of the
  profile (`storyArticles`), the news itself added to them when its feed is not one of the reader's; found without a story (older than
  48 hours, the vectors and stories are made for those only): that article alone; not found: the page, a plain fetch of a public address
  by `Crawlers.Pages` (20 s, 5 redirects, then Readability; no headless browser), an article of its own with the language
  `languageOf` finds. No text, or under 60 words (`canSummarize`): 422 "This page could not be read: no article in it, a
  paywall or a protected site."
- Then `completeCards` (the steps 4 to 7 of `write`, moved to a function of their own: the briefing and the news added are the same
  code), `review: false`, the stories of the other cards of the briefing given as `alsoShown` (no angle of the news is one of them),
  `story.lead` read first (`toRead`). No passage: 422. A step failing (the names, the angles, the official sources, the AI version...)
  leaves the card without it, as in a briefing; a failure of the whole leaves the news added as the page alone gives it
  (`importedCard`: the key passages, the 3 points, the summary, their translation, the AI version, the topic, the sourcing), as it was
  before 03.11.2026.
- The card: `imported: true`, no why, no interest, no project, no follow-up, no thumb, `feedUrls` empty (nothing blamed on a feed by a
  thumb), and everything else as a card of the briefing has it.
- Its analysis: `BriefingModel.startAnalysisOfAdded` opens the analysis of the briefing again (`running`, the card among the cards picked,
  `importing` counting the cards added being written, so that several added in a row are written together), only when it was
  written (`ready`); the answer says `analyzing: true` and the page, which asks for a running analysis until it is written, shows
  the card as waiting. `analyseAdded` runs after the answer: `cardAnalyses` as for a briefing (the AI picks the cards that merit one,
  it may find none), with the id of its story for the timeline of its affair; `finishAnalysisOfAdded` saves its lines under the id of
  the card, or takes it off the cards picked, and closes the analysis (`ready`) once every card added has its answer; no lines for a
  card taken out meanwhile. Not for a card copied from another briefing: it comes with its own.
- `BriefingModel.addItem` appends it to `briefings.items` in one statement (`ADD_ITEM`), its `storyId` the
  next negative one (-1, -2, ...): it is of no story, and two added at the same time get two ids. The same
  statement checks the briefing still has fewer than `MAX_IMPORTED` news added and none of its links: two
  news added at once can't pass 10 nor add one link twice (until 17.10.2026 only the service checked, before
  reading the page). Refused there, the briefing is read again to say why (409, 400, else 404). The answer
  carries the terms the profile follows, marked (`withMarks`, `EntityService.followTerms`).
- `removeNews`: a negative `storyId` only, removed by `BriefingModel.removeItem` (0 rows: 404 "Unknown news
  added."). A card of a story can't be removed this way.
- The tokens of the calls are logged ("news added by its link, tokens ..."). A news added takes about a minute or two, the
  page says so while it waits.

## The version another profile wrote of a card

The same news is the same story in every profile, but each profile reads it from the articles of its own sources, so the cards
differ: the lead article, the picture, the points. A reader with several profiles (the user's friend, 9.11.2026: three profiles, the
Wenger news better written in one than in the other) takes the version he prefers **without leaving the profile he reads and without
a link to paste**: pasting the link was refused ("This news is already in the briefing": one of its articles is on a card), and a
card added by its link is a news "of no story", beside the other card of the same story.

- `GET /api/briefing/:id/versions` answers `{versions: {storyId: [{briefingId, profile, createdAt, title, source}]}}`: for each card of the
  briefing, the same story (its story id, or one of the stories merged into it) in a card of the other ready briefings of the
  account of the last 7 days (`BriefingModel.versionsOf`), with **another lead article**, of **another profile** that reads in the
  **same language** (its translations are of that language); one version a profile, its newest briefing. No call of the AI.
- The card shows, in its right column, "Another version: Chris wrote it from hln.be, in its briefing of 9 Nov, 07:23 — Use Chris's
  version" (`BriefingCard.jsx`, `versions` and `onUseVersion`).
- `POST /api/briefing/:id/stories/:storyId/version {fromBriefingId}` replaces the card **where it stands**
  (`BriefingService.useVersion`, `swappedCard` of `services/utils/card-versions.js`, one statement `REPLACE_CARD`) and answers
  `{item, analysis}`. The card keeps its story id (so its other media, its follow-ups and the affairs stay the card of that story), and what
  belongs to this briefing: its place, why it was chosen for this profile, its interest and project, its follow-up, the thumb, the feeds a
  refusal is blamed on, the mark of an e-mail sent. It takes the rest of the other version: lead article, title, picture, passages, points,
  summary, AI version, other angles, official sources, denials, names, countries, and the analysis lines written for it (when that
  briefing has its analysis ready, else the lines stay). What the reader of the other briefing wrote for its e-mail and its marks are not
  carried (the terms this profile follows are marked again).
- The card it replaced stays on the card (`previousVersion`, with its analysis lines) and the page is only told which one it was; the card
  then says "Chris's version" and "Back to the one of this profile (lesoir.be)": `DELETE /api/briefing/:id/stories/:storyId/version`
  (`restoreVersion`, `restoredCard`) brings it back with the thumb it has now. Replaced again, the way back is still the first card.
- Both are after `authenticateToken` only (they read and write the reader's own briefings and call no AI); the POST 120 an hour per
  reader. The news added by their link are not concerned (no story): the link of another article of the same news is still refused.
- Tests: `tests/briefing/test.card-versions.js`, `tests/briefing/test.replace-card.js` (the SQL in the database, in a transaction rolled
  back), `tests/briefing-versions.test.jsx` of the client.

## Diagrams

- [Class diagram](briefing-news-by-link-class.png) ([source](briefing-news-by-link-class.puml))
- [Sequence diagram](briefing-news-by-link-sequence.png) ([source](briefing-news-by-link-sequence.puml))
- The briefing: [08-briefing](../08-briefing.png), [08b-briefing-cards](../08b-briefing-cards.png);
  the e-mail: [09-email](../email/09-email.png), [26-email-sequence](../email/26-email-sequence.png)

## See also

- [Email](../email/README.md): what the news is added for
- [Key passages](../key-passages/README.md): the passages chosen as for a card
- [Bullet points > Bullet points (IA)](../bullet-points/bullet-points-ia/README.md),
  [Summary > Summary (IA)](../summary/summary-ia/README.md): the AI version written with it
- [Accounts > Login and session](../../accounts/login-and-session/README.md): `GET /api/session` says
  whether the reader is an administrator (role `Admin`, `services/utils/admin.js`)
