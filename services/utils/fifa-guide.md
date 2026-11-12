# Annotation guide: the position of a football association on a candidate for the FIFA presidency

You label PASSAGES of news. Each passage is one sentence that names a person (the *candidate* of the label: Gianni Infantino, Kozo Tashima,
Arsène Wenger or Ramon Vega) and an association (a national football association or a confederation of FIFA). You say what the passage
shows of the position of THAT association on THAT person. Use only the text you are given (the sentence, the title and the description of
the article, the medium, the language, the date). Do not use what you may know about the election, and do not guess.

The point of the study is **precision**: it is better to say "uncertain" than to colour a wrong association or a wrong side. A passage
labelled `established` ends up as a colour on a map, read by people.

## The fields of a label

```json
{"id": "...", "about_election": true, "association_ok": "yes", "speaker_kind": "president", "stance": "against", "toward": "person",
 "mark": "official", "level": "declared", "status": "established", "reason": "", "confidence": "high", "note": ""}
```

**about_election** (true/false): the sentence is about the election or the leadership of FIFA: standing, being re-elected, backing, opposing,
asking the person to go, looking for a rival, refusing to back, endorsing a candidacy. False for anything else (a tournament, a stadium,
money for the members, a sponsorship, a lawsuit that is not about the post, the person merely present at a meeting).

**association_ok** ("yes" or "no"): the association named in the label is really the one the sentence is about. "yes" only when the text
itself establishes it (its full name, its country, the speaker given as its president, a name that has only one owner). "no" when the
name written is another association (the "Federcalcio mauritana" is Mauritania's, not Italy's; "JFA" with Jordan in the text is not Japan;
"FMF" is Mexico's or Moldova's), when the text does not say which country the initials are of, when the association is only a place, a host
or a member of a list, or when someone else speaks about it (a journalist, a rival, the person). When in doubt: "no".

**speaker_kind**: who says it, one of
- `president`: the current president or chairman of this association (a confederation's president for a confederation);
- `executive`: its committee, board, general secretary, chief executive or spokesperson;
- `statement`: the association itself: its statement, release, website, decision or vote, "the federation says";
- `deputy`: a vice-president or another officer of the association, speaking for himself;
- `former`: a former or honorary president or official;
- `candidate`: the speaker is the person of the label, speaking for himself;
- `government`: a minister, a state body or a head of state;
- `other`: a journalist, a pundit, an agent, an unnamed source, another body, anyone else;
- `none`: nobody is named or implied.

The association is **bound** (speaks as itself) only by `president`, `executive` and `statement`.

**stance** toward the person: `for` (backs, supports, wants him to stay or to be elected), `against` (opposes, criticises, wants him gone,
will not support him, looks for someone to beat him), `undecided` (too early, has not chosen, weighs it), `none` (no stance appears).
**toward**: `person` (the stance is toward the person of the label), `other` (toward someone else, a rival or another candidate), `nobody`.

**mark**: `reported` when the text itself hedges (an unnamed source, "reportedly", "according to", "would", "is said to", "could",
"weighs", a rumour); `denied` when the association or the person denies it; `official` otherwise: what a named person or body says,
demands, decides or does, told plainly, is official even if the journalist writes it with no quotation marks.

**level**: `declared` = a bound speaker says plainly, as the position of the association, that it backs or opposes the person, or asks him
to go or to stay; `probable` = any other `for` or `against` (praise, thanks, a criticism that does not say "I oppose", a hint, a bound
speaker who is not clear, a reported claim); `none` when there is no stance.

**status**, the decision:
- `discarded`: `association_ok` is "no", or `about_election` is false. Nothing is shown.
- `established`: `association_ok` "yes" AND `about_election` true AND `toward` = `person` AND `stance` = `for` or `against` AND the speaker is
  bound (`president`, `executive`, `statement`) AND `mark` = `official`. The map is coloured from these.
- `uncertain`: `association_ok` "yes" AND `about_election` true, but the position is not established. Shown with the badge "Uncertain" and
  not coloured. Give the **reason**.

**reason** (for `uncertain`; `""` otherwise), the first one that applies:
- `not_binding`: the speaker is a `deputy`, `former`, `government` or `other` (a vice-president resigning in protest, an honorary president,
  a minister, a pundit): the association itself has not spoken;
- `rival`: the speaker is a candidate, or the passage is about a rival candidacy coming from the association (an honorary president
  announcing that he runs against the person);
- `request`: someone asks or urges the association or the person to act (a candidate asking an association for its backing);
- `reported`: a rumour, a hedged claim, an unnamed source;
- `denied`: the association or the person denies it;
- `past`: a position taken earlier and no longer current ("it backed him in 2023");
- `praise`: thanks, praise or congratulations of the person or of what FIFA did under him, with no word of the election, of his staying or of
  the association backing him (rule 5);
- `ambiguous`: the wording is unclear, the association has not chosen (`undecided`), the sentence mixes both sides, or you cannot say whether
  it is a position;
- `other`: none of the above (say why in `note`).

**confidence**: `high` when you would bet on every field, `low` when a reasonable reader could label it otherwise. Say what in `note`
(one short sentence, in English).

## Rules that settle the usual doubts

1. A **confederation** is an association like the others for this study (it does not vote in the election, but its stance is still
   a stance). Its president (UEFA's, the AFC's...) binds it.
2. A **vice-president, a former or honorary president, a board member speaking for himself** do not bind the association, even when
   the text says "of the Japan Football Association": `uncertain`, `not_binding`.
3. A **candidate** who is also an officer of an association (an honorary president who runs) gives his association no position:
   `uncertain`, `rival`, `speaker_kind` = `candidate` when he speaks.
4. **Criticism by a bound speaker** that does not say "I oppose" or "I will not vote for him" is `against`, level `probable`, and is
   `established` (a bound speaker, official, a stance toward the person). A plain "we will not back him", "he must step down" is
   `declared`.
5. **Thanks, praise, congratulations** to the person, and praise of what FIFA did under him (its programmes, its funding, its results: "the continent
   has benefited immensely under the leadership of the president") are NOT a position by themselves (decided by the user, 12.11.2026): the status is
   `uncertain`, the reason `praise`, whatever the other fields say. They count as `for` (`probable`, `established`) only when the same sentence also
   says that he should stay or be re-elected, or that the association backs him or will vote for him. A thank-you for a visit or a tournament, with
   nothing about him or his post, is `about_election` false.
6. **"Looking for a challenger", "weighing a run"** by an association (UEFA looks for someone to stand against him) is a stance `against`
   when it names the association as the one doing it and is told plainly; `reported` when hedged.
7. **A passage about the person as a candidate for another post, or about a person with the same surname**: `about_election` false.
8. When the passage is a **title only** (the description adds nothing), label what the title says.
9. The same label rules apply in every language; read the sentence as written.

## Rules added after the first labelling (12.11.2026, decided by the user; the labellers above worked without them)

10. **Criticism of the conduct of the FIFA president** (the money of the World Cup, the investor plan, the AFC congress) by the head of an
    association counts as a stance `against` toward the person even when the sentence does not mention the election: `about_election`
    is true, level `probable`, status `established`. "I will not back him", "he must go", "no confidence" stay `declared`.
11. **A headline or a journalist who says that an association supports someone** ("UEFA will support Kozo Tashima", "the AFC joins
    CONMEBOL, CAF and OFC in backing Infantino"), with neither the association nor a named official speaking, is `uncertain` with
    the reason `not_binding`. What an association itself decides or ratifies ("Conmebol ratified its backing"), told as the fact it
    is, stays `established`.
12. **Context sentences about the past** (an old joint letter, "initially leading the opposition") are `uncertain`, reason `past`.
13. **A hint** (opening the door to a rival, expecting an alternative) by a bound speaker is `established`, level `probable`.
14. **Support for someone else is not opposition to the candidate of the label.** When the label is about Arsène Wenger and the sentence says
    that CONMEBOL ratifies its backing of Infantino, the stance is `for` toward ANOTHER person: `toward` = `other`, status `uncertain`,
    reason `rival`. Opposition to the candidate has to be said about him (he must go, we will not back him, a challenger is
    sought against him); never infer it from support given to his rival, and never infer support for him from criticism of his rival.
