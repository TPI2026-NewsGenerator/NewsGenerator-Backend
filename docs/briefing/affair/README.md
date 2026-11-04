# Briefing > The affair

A card that is one affair (a dispute, a scandal, a race, a saga told over days) shows its name and, on demand, **its
events on a horizontal line** and **how widely the media talked of it**. The events are the facts of the affair of
the last 30 days in any language, each at the date of its first news; a fact told in 23 languages is one event.
Nothing is chosen by the reader: the system finds the affair, names it, and builds the line by itself.

## Where

- Client: `client/src/features/affairs/`. `AffairSection.jsx` under the passages of the card (the name of the affair,
  a button, a bar while the server works); `AffairTimeline.jsx` the line, the detail of the event chosen and the
  list of every event; `AffairCoverage.jsx` the coverage; `timeline.js` where each event stands (the date as a
  distance, the labels on three lanes, the minor events stacked). The page asks the cards that are an affair once
  the briefing is ready (`Briefing.jsx`).
- API: `GET /api/briefing/:id/affairs` answers `{affairs: {storyId: {title, stories, media}}}`, `GET
  /api/briefing/:id/stories/:storyId/affair` the affair of one card. 60 an hour each.
- Server: `services/affair-service.js` (`chips`, `view`, kept in memory 24 h for the name and 3 h for the affair,
  two requests for one card waiting for one build), `services/utils/affair.js` (the build), `affair-judge.js` (the
  prompts of the AI), `affair-events.js` (the events, their marks), `affair-coverage.js` (the coverage),
  `models/affair-model.js` (the stories found in the database).
- `node scripts/affair-view.js <storyId> [--close=80] [--max=160] [--trace=file.json]` prints the affair of a card as
  the page shows it and, with `--trace`, every story of the pool with the verdict on it. `bench/affairs/` has the
  explorations and `affair-mock-api.mjs`, a local API with the real affairs to see the page without a session
  (launch configurations `mock-api-affair` and `client-affair`).

## How it works

1. **Which cards.** A card is looked at when the thread of its story (the news the grouping put together as one
   affair, in one language, see [Stories and threads](../../ingestion/stories-and-threads/README.md)) holds 3
   stories told by 3 media (`MIN_STORIES`, `MIN_MEDIA`): 217 of the 706 cards of the last 40 briefings. The AI is then
   asked once, from the titles of the thread, whether it is **one affair** (`affairFilePrompt`) and to name it: a
   series of matches, a field or a person's unrelated stories are not. The name is kept only if every capitalized
   word of it is in the news it was written from, else the title of the card stands for it; acronyms are kept as
   written. The briefing asks nothing more: the affairs are built after it, in background, one card after the other.
2. **The stories around the card** (`AffairModel.candidates`, `storiesOfSameNames`): the ones of its thread, the 80
   closest by their centroid of the last 30 days in any language (from a likeness of 0.62), and the ones naming its
   rare names. 4 to 6 s of the database for 1.8 million stories.
3. **The AI judges them against the file** of the affair (its name, what it covers, what it does not), 40 at a
   time, oldest first (`judgePrompt`): "in" (in doubt, no), "key" (a new fact) or "minor", "as" (tells the same fact as
   an earlier one), and "denial" or "official". The vectors can't do it: "40 African nations can host matches at
   home" was 0.86 from the card, as close as the reaction of Norway.
4. **The events** (`eventsOf`): the stories telling one fact are joined when the AI says so and their vectors agree
   (0.80, within 3 days); then all the events are read once more together (`sameFactEvents`) to join the ones
   the calls kept apart. A denial is never joined to what it denies. The date of an event is the one of its first
   news, unless the feed got it wrong (a page re-dated, dated ahead): the day we saw the story then stands.
   The lead of an event is its story in the reader's language, else the most told; its title is translated (the language read from its letters, see [Other angles](../other-angles/README.md)) when
   it is in another language, the original on demand.
5. **The marks**, never a verdict: *Reported* (half of its news hedge, `hedging.js`), *Official* (the AI says a party
   announced it **and** a news of it quotes a statement or a release, `statements.js`), *Contested* (the AI says
   someone denies it **and** a verb of denial is in its news, `contested.js`). An event is *key* only when the AI
   says it brings a new fact **and** two media tell it or a party announces or denies it.
6. **The coverage** (`coverageOf`, no AI): the media and the news of all the stories of the affair, whatever
   their language, each link once, the first medium to tell it, the media of each day, the languages, and the media
   one after the other as they joined. It counts what we read: it says how much it is told, not whether it is true.

## Measured

On the real database (4.11.2026), `bench/affairs/`:

- The affair of UEFA against Infantino: 238 stories of 30 days in 25 languages, 207 to 215 kept, 65 events (105
  before the joining of the events), 25 s and 26 000 tokens; the name the AI gave was kept in most runs, once of about
  six (and for AFCON, before the rule on acronyms) it fell back on the title of the card. Of the 95 stories kept farthest from the card, none was off subject; the
  24 left out were mostly on borderline matters (the DR Congo player, the funding plan for the federations).
- Not an affair, rightly: "AI agents learning to improve their software" (a theme), a futsal tournament of Dakar. An
  affair: Morocco's new government (24 events), Everton and the Friedkin Group (32), AFCON every two years (22).
- A few ms for the thread alone, 2 to 3 s for the names of 8 cards, then 13 to 26 s to build an affair.
- Known limits: the events go back 30 days (the retention of the news), the dates are the ones of the first news and not
  of the event, the coverage counts the feeds we read.

## Following an affair

A box under the name of the affair, "Follow this affair" (`FollowAffair.jsx`), keeps the affair and watches it. Nothing is asked of
the reader: the name is the AI's, the events are the ones above, and every event the affair has when it is followed is known (none
rings for what they could read). The reader only follows or stops following. Up to 20 affairs a reader.

- Tables (`db/add_affairs.sql`, run it before the server of this version): `affairs` (the reader, its name, its file for the AI, the
  stories of its events, its **view**: events and coverage as the page shows them, so they stay after the 30 days of the news),
  `affair_alerts`, `push_subscriptions`. An affair is no thread: a thread is of one language, is joined to another and goes with its
  news, so what is followed is its own row. `POST /api/affairs {briefingId, storyId}`, `GET /api/affairs`, `GET /api/affairs/:id`,
  `POST /api/affairs/:id/seen`, `DELETE /api/affairs/:id`, `GET /api/affairs/unread` (the badge of the bar).
- Pages: `/affairs` (the affairs followed, the last event, the alerts not read, the button for this device) and `/affairs/:id` (what
  it gave since, its line, its coverage, "Stop following").

## The watch

`AffairService.watch` runs 3 minutes after the server starts and every 15 minutes (`AFFAIR_WATCH_MINUTES`), one run at a time, 2
affairs at once, in the server that does the ingestion (`INGEST_IN_SERVER`). For each affair (`affair-watch.js`):

1. **The new stories** (`AffairModel.fresh`): the stories created since its last check that are in the threads of its stories or
   close to the centroid of its stories (0.62), in any language, 120 at most. Only the new ones are compared: a few dozen a check
   against the 1.8 million stories of the month; the first check starts from when the affair was built.
2. **The AI judges them** against the file of the affair as in the view (`judgeStories`), and their events are made and joined to the
   ones the reader has (`mergedNew`): a story telling a fact the reader has is added to that event, which keeps its place.
3. **The events of the last 3 days are counted again** (`refreshedEvent`): an event only one medium told and the AI found a new fact
   becomes a key event when a second one tells it, and is looked at again.
4. **Only a key event is a candidate** (the AI says it brings a new fact **and** two media tell it, or a party announces or denies it),
   and it is read once more (`confirmEvents`, thinking on): about this affair itself, a new fact that changes where it stands, not
   told before (the facts the reader has and the alerts of the last 14 days are given), in doubt no. An event is asked once; the AI
   failing, it is asked at the next check and nothing rings for an answer not had.
5. The coverage is counted again over the news held and joined to the days no longer held (`mergedCoverage`), the events and the
   stories saved, the alerts written.

## Alerts and push

An alert is a key event the second opinion let through (`affair_alerts`): the page shows it with "new" until the affair is opened.
`PushService` (`web-push`) then tells every device of the reader, one notification per affair (its name, the fact or a short list),
that opens `/affairs/:id` (`client/public/sw.js`). An alert is sent once, when a device took it; none for a reader with no device
(it is in the page); none for an alert over 24 hours old; a device the push service says is gone is forgotten. One affair rings at
most twice in 3 hours: the alerts that come meanwhile wait and go out together as one list (`held`).

- The server needs `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`.env.example`); without them nothing is sent and
  the page says so.
- On an **iPhone** the site must be added to the home screen and opened from there (iOS 16.4 and later): only then does the browser
  offer push. The button "Notify me on this device" (`PushToggle.jsx`) asks the leave from a tap, as iOS requires.

### Measured

Replay of the watch over the 10 days before 4.11.2026 on the affair of UEFA against Infantino (`bench/affairs/replay.mjs`: the
affair reset to what it was 10 days ago, its stories checked 24 hours at a time): 11 alerts, read by hand, 5 right, 4 borderline
(related, or already told in other words), 2 wrong (the discipline of a prince in another confederation, a candidate told again six
days later), 1.1 a day on a very active affair. The second opinion on these 11 (`bench/affairs/confirm-bench.mjs`): the first prompt
let through 4 right, 2 borderline, 1 wrong; with the condition "about this affair itself" and the alerts already sent given, 4 right,
2 borderline, none wrong; deepseek-v4-pro, stricter, 3 right, 1 borderline, none wrong. That is 11 alerts of one affair: it says the
second opinion stops what the rule lets through, not how many it stops in all.

A wave that spreads (the cyberattacks on the supermarkets of Europe, replayed over 2 days, `bench/affairs/confirm-bench-cyber.mjs`) gave 10
alerts, none wrong but 5 of them one more country or company of the same wave. The clause "the same kind of fact happening to one more
country, company or person is not new unless it changes the nature or the scale" brought them to 3 (the spread beyond France, the
identity of the hackers, a company's forecast) and left the Infantino alerts as they were; two the reader may have wanted (Germany, the
British meat firms) stay on the line only.

A real follow and check against the database (`bench/affairs/live-check.mjs`, 4.11.2026, on that affair set back two days): follow, a second
follow of the same card answered "already", 100 stories judged in 30 s, the events from 12 to 58, 10 alerts written then read, the unread count
from 10 to 0 once opened, everything deleted.

## See also

- [Other angles](../other-angles/README.md): the stories of the same affair, from the card's side; the pool here
  is the same one, wider.
- [Corroboration](../corroboration/README.md): "Told by N media" of one fact, and what a count of media says.
- [Denials](../denials/README.md) and [Official source](../official-source/README.md): the words behind the marks.
- [Search](../../search/README.md): a thread shown as one card, the first version of this line.
