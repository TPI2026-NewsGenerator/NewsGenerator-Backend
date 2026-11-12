# Briefing > The FIFA presidency map

A page of the app (`/fifa`) with a world map of the 211 member associations of FIFA, and the six confederations, coloured by their **public
position on a candidate for the presidency of FIFA** (the person in office, then the candidates a reader adds). The position is read in
the news by the system, shown with the sentence, the medium and the date that explain it, and **any signed-in reader can vote on it: the
latest vote decides for everyone**. The page says first what it does not know: most of the 211 are grey.

## Where

- Client: `client/src/pages/Fifa.jsx`, `client/src/features/fifa/` (the map in SVG with `d3-geo`, the list, the sheet of an association, the
  timeline, the presidents, the confederations, the vote). The contract it reads is in `client/bench/fifa/README.md`.
- API: `GET /api/fifa/map`, `GET /api/fifa/associations/:qid`, `GET /api/fifa/presidents`, `GET /api/fifa/confederations`, `GET /api/fifa/subjects`,
  `GET /api/fifa/people?q=` (the persons of Wikidata a reader picks a candidate from), `POST /api/fifa/subjects` (a reader adds a candidate),
  `PATCH /api/fifa/subjects/:qid` (its status), `POST /api/fifa/votes`; an administrator can `DELETE /api/fifa/subjects/:qid` and
  `DELETE /api/fifa/votes/:id`. The session of the reader (cookie), not the key of `/api/v1`.
- Server: `services/fifa-service.js` (the reading in the background, what the page asks), `models/fifa-model.js`, `controllers/fifa-controller.js`,
  `routes/fifa-router.js`; the pure parts in `services/utils/`: `fifa-members.json` (made by `scripts/build-fifa-members.js`), `fifa-passages.js`
  (which sentences are read), `fifa-attribution.js` (which association a passage is about), `fifa-reading.js` + `fifa-guide.md` + `fifa-labels.js`
  (the reading and the rules the code applies), `fifa-positions.js` (the position from the signals), `fifa-map.js` (the shapes of the page).
- Tables: `db/add_fifa_map.sql` (`fifa_subjects`, `fifa_signals`, `fifa_votes`, `fifa_leaders`), see [the MLD](../../database/mld.md).
- Settings (`.env`): `FIFA_COLOUR` (`established` default, `declared`, `off`), `FIFA_WATCH_MINUTES` (30), `FIFA_MODEL` (the default model of the
  AI), `FIFA_CONFIRM_MODEL` (`deepseek-v4-pro`).
- The measure and its tools: `bench/fifa/` (census, gold set, variants), the figures in [Quality](../../quality/README.md).

## How it works

1. **The passages.** Every FIFA_WATCH_MINUTES the news that name a candidate (by the last word of his name) since the last run are searched, and
   each sentence that names him and a member (by its name, its acronym linked by the tagger, or a name found in the text) is a **passage**. One per
   story; a confederation counts only when the sentence holds a word of support or opposition.
2. **The association, by the code.** Whether the passage is about THE association is decided by the code, not the AI: a name that says its country is
   enough; a bare acronym ("JFA", "FMF", "NFF") or a generic word ("The FA", "Federcalcio") needs the country in the text and none of the other
   countries that write the same letters. What cannot be shown is left out (never shown as "uncertain" under the wrong country).
3. **First reading.** A model (`gemma4:31b`) reads the passage with the guide (`fifa-guide.md`): who speaks, whether they bind the association, for or
   against, how plainly, official or reported, with the exact words. The **code** decides the status from these words: `established` (a bound speaker,
   official, a stance toward the person), `uncertain` (about the election and the association but not a position: a vice-president, a rumour, a
   request, a rival, the past), `discarded`.
4. **Second reading.** What would colour the map is read again by a model of another family (`deepseek-v4-pro`, thinking): both must give the same
   side, else the passage is only uncertain (`readings_disagree`); it is "declared" only if both say declared, else "probable". A passage whose second
   reading failed stays uncertain (`unconfirmed`) and is read again at the next run: nothing colours without it.
5. **The position.** From the established signals of an association on a candidate (`fifa-positions.js`): the latest holds it; a flip to the other side
   needs a declared signal or two signals; one probable signal against a declared position makes the indications "conflicting"; a position older than
   90 days is stale. An uncertain signal never colours: it is counted and shown with its badge ("Uncertain") and its reason.
6. **The vote and the confirmation.** A reader votes `for`, `against`, `unknown` ("no position") or takes the vote back; or `confirm`s the position of the news ("Confirm this position"): it is a **validation by hand, the heaviest word there is**, so the position is
   drawn **solid, at the declared level**, whatever it was (a probable one included), with the reading of the news kept (`ai_position`) and never aged. It records who confirmed
   which position (`fifa_votes.seen`); once the news change the position the confirmation is "outdated" and validates nothing: the reading of the news shows again. A
   confirmation is no decision (a vote that sets a position still wins over it), and taking the vote back takes the reader's confirmation away too. Of each reader the latest vote counts and the newest of
   those decides for everyone; the position of the news stays visible under it, and when the news say the other thing after the vote the sheet says so
   ("new evidence since the vote") without changing the colour. Votes are only added (who, when), an administrator can take one off, a reader is limited to
   30 votes in 10 minutes.
7. **The candidate an association leans toward.** An association has one vote, so it leans toward at most one candidate. When no candidate is chosen on the page and a reader
   clicks a country, the reader chooses which candidate it leans toward (`POST /api/fifa/leans`, `subject`: a candidate, `none` or `withdraw`). Choosing candidate X sets the
   association FOR X (a vote, so solid) and "no position" on each other candidate it was shown supporting; opposition is never inferred nor touched; all the votes of a
   choice are written together, and a choice that already stands writes nothing. The map says it for each association (`lean`: the candidate, "reader" or "news", or the candidates
   in conflict). With one candidate chosen on the page the reader confirms or changes the position on that candidate instead (item 6).
8. **A candidate is added by a reader**, with no validation: a person of Wikidata, at most six on the map (one colour each; when it is full the oldest
   candidate marked `withdrawn` makes room), three a day for each reader. The 30 days of news are then read: about 4 600 tokens a passage, so about 3 million tokens (about 1.5 dollars of credits)
   for the person in office (680 passages), about 0.5 million (0.3 dollar) for a candidate named in 130 sentences, and at most 800 passages whoever it is
   (`FIFA_MAX_PASSAGES`, the newest). Then about 57 new passages a day for four candidates, about 4 dollars a month.
9. **The presidents.** First the public page of each association on the site of FIFA (`inside.fifa.com/en/associations/{code}/organisation`, read by `services/utils/fifa-site.js`:
   its robots.txt allows it, one request every 1.2 s with a User-Agent that says who reads, once a week, 211 pages in about 6 minutes; `FIFA_SITE_LEADERS=off` reads none).
   Then Wikidata (`P488`, once a day): it gives the item of the person when it names the same one, and the president of an association whose page names none. Fewer than
   100 presidents from the site (it is down or changed) leaves the ones of the week before. Each president carries his `source` (`fifa` or `wikidata`) and its page.
   What the news say of him comes with it, from our own tagged news of the last 30 days: the number of articles that name him and the latest one (medium, link, title),
   asked by his item of Wikidata or by his name, kept a quarter of an hour (`GET /api/fifa/presidents`: `articles_30d`, `last_mention`).
   The figures of articles of an association (`coverage` of the map, `articles_30d` / `media_30d` of each position and of the sheet) are the ones of the last 30 days
   too (`recentCoverage` in `fifa-map.js`): a signal stands for the articles that carry its passage and is dated by the news it shows; an older one still colours (a position
   stays 90 days) but is not counted, and an article that names two candidates (two signals, one link) is counted once.
10. **The weekly audit** (`services/utils/fifa-audit.js`, `FifaService.audit`, `node --env-file=.env scripts/fifa-audit.js [--days=7] [--sample=30] [--dry]`). Once a week
   (`FIFA_AUDIT_DAYS`, checked every hour, so a deploy does not start the week again) a random sample of 30 established signals (the ones of the last days first) is read
   again by a **third model**, of a family that read neither time (`FIFA_AUDIT_MODEL`, `gpt-oss:120b`); it agrees when it says established on the same side. The
   votes of the readers are counted against the news too: a reader who sets the other side, or no position where the news gave one, contradicts the system. The result
   is kept in `fifa_audits` (an administrator reads the last ones at `GET /api/fifa/audits`) and written in the log; below `FIFA_AUDIT_MIN_AGREEMENT` (85%) the verdict is
   `warning` (with the disagreements listed: look at them, and think of `FIFA_COLOUR=declared` or `off`), under 10 signals `too_few`. It is an agreement with a model, not the
   truth: the gold set of `bench/fifa` is the truth, this is the live drift.

## When a rule of the guide changes

The signals already read keep the answer of the old rule, so a rule is applied to its FAMILY, never to one line by hand: `node --env-file=.env scripts/fifa-reread.js --family=praise`
reads again the established signals whose words match (a regular expression of Postgres) with the rules of now, by the same reading as the news that come, and says what changes;
nothing is written without `--apply`, and only a change that comes from the rule itself (here the reason `praise`) is written: the two models do not give the same answer every
time, so a family read again also shows "noise" (a signal that would turn `readings_disagree`), told and left alone. The rule of 12.11.2026 (decided by the user): praise or thanks of
the person, or of what FIFA did under him, with no word of the election, of his staying or of the association backing him, is no position (`uncertain`, reason `praise`, shown as
"praise only"); it counts as support only when the same sentence says one of those. It was found on the South African association, whose president thanked FIFA and said the continent
"benefited immensely under the leadership" of its president.

## Measured

On a gold set of 308 passages of 4 candidates (labelled by three labellers, 12.11.2026), the chain above gives **3.3 % of wrong colours (2 of 60 shown) on the half
used to tune it and 11.8 % (4 of 34) on the half kept sealed**; coloured only when declared, 0 of 17 on the sealed half and 2 of 63 over both. The figures, the
way the set was made and what they do not say are in [Quality](../../quality/README.md#the-fifa-map-the-position-of-an-association-on-a-candidate).
A wrong colour is an association coloured while the gold set says it should not be, or not on this side (a wrong association, a passage that is not about
the election, a position that was only uncertain). `FIFA_COLOUR=declared` colours only the declared; `off` colours nothing (the signals keep being read).

## See also

[Quality](../../quality/README.md), [The affair](../affair/README.md) (the model of the background reading and of the key events),
[Friend API](../../deployment.md) (`/api/v1/news`, which is another route and makes no AI call).
