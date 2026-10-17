# Briefing > News by link

An administrator can add to a ready briefing a news the briefing did not choose, by pasting its link: the
server reads the page, chooses its key passages and writes its AI version as for any card, and the news
comes last in the briefing, marked "Added by you" and ticked for the e-mail. It is meant to be sent with
the other cards. It has no other media, no angle, no denial nor official source, and no thumb. It can be
taken out again.

## Where

- `client/src/features/briefing/components/AddNews.jsx`: "Add a news by its link", in the column of the
  page `client/src/pages/Briefing.jsx`, shown only when `GET /api/briefing` answers `mail: true` (the
  server has an SMTP account and the reader is an administrator). `addNews()` appends the card and ticks
  it; `BriefingCard.jsx` shows "Added by you" and "Take it out" (`onRemove`).
- API: `POST /api/briefing/:id/news {url}` (201 `{item}`), `DELETE /api/briefing/:id/news/:storyId`
  (204), both after `authenticateToken` and `adminOnly(MAIL_REFUSED)` (403 for the others); the POST 30
  an hour per reader (`rateLimit`, 429).

## How it works

- `BriefingService.importNews` (`services/briefing-service.js`): the address 2000 characters at most
  (`MAX_URL`) and public (`assertPublicUrl`, `services/utils/public-url.js`: http(s), every IP of the name
  public; else 400); a ready briefing of this reader (`readyBriefing`, else 404).
- Refused: a link already the lead or an article of a card (409), and an 11th news (`MAX_IMPORTED` = 10
  per briefing, 400); checked before the page is read, and again by the statement that adds it (see
  `addItem` below).
- The page is read by `Crawlers.Pages` (`services/utils/crawlers.js`): a plain fetch of a public address,
  20 s, 5 redirects, then Readability; no headless browser. No text, or under 60 words (`canSummarize`):
  422 "This page could not be read: no article in it, a paywall or a protected site."
- `importedCard`: `extractArticle` (`services/utils/extract.js`, gemma4:31b, Gemini when Ollama fails) for
  the key passages, the 3 points, the summary, their translation into the reader's language, the topic and
  the sourcing. No passage: 422. Then only `aiWaysOf` (`services/utils/ai-ways.js`, deepseek-v4-pro:0813,
  thinking off) for the AI version, `null` when it fails: a page refused costs no call of deepseek (both were
  asked together until 17.10.2026). A title in another language is translated.
- The card: `imported: true`, the page's title, the reader's language (`readerLanguage` of the
  briefing's profile), no why, no interest, no other media (`articles` is the lead alone), `hedged` from
  its title and description, its picture when the page gives one of the web.
- `BriefingModel.addItem` appends it to `briefings.items` in one statement (`ADD_ITEM`), its `storyId` the
  next negative one (-1, -2, ...): it is of no story, and two added at the same time get two ids. The same
  statement checks the briefing still has fewer than `MAX_IMPORTED` news added and none of its links: two
  news added at once can't pass 10 nor add one link twice (until 17.10.2026 only the service checked, before
  reading the page). Refused there, the briefing is read again to say why (409, 400, else 404). The answer
  carries the terms the profile follows, marked (`withMarks`, `EntityService.followTerms`).
- `removeNews`: a negative `storyId` only, removed by `BriefingModel.removeItem` (0 rows: 404 "Unknown news
  added."). A card of a story can't be removed this way.
- The tokens of the calls are logged ("news added by its link, tokens ...").

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
