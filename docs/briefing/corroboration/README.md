# Briefing > Corroboration

The project scrapes many media at once, so it can say how widely a news is carried. It says that,
and refuses to say anything else: **a rumour repeated by twenty sites is still a rumour**, and no
number here means a news is true.

These things are shown next to a news, each one measured, none of them a verdict:

| Shown | Where it comes from |
|---|---|
| `Told by N media` | how many different media the group holds, counted per medium and not per feed (`mediumOf`). In the briefing, a news read through Google News counts for the medium Google names as its publisher, not for google.com |
| `M own headlines` / `one single text republished` | in the list of a search: the same titles grouped a second time at 0.85, which is the threshold of the same text: a wire of Reuters republished by twenty sites gives twenty media but one wording, and that is one report seen twenty times, not twenty confirmations. Never more than `N`. |
| `M different texts of R read`, `wire: AFP` | once the articles are read (a card selected in a search, a story of the briefing): up to 5 texts per card, compared on their sequences of eight words. Two texts are the same copy when half of the sequences of the shorter one are found in the other, because a paper rewrites the title of a wire and keeps its text. It also names the agencies the texts credit ("avec AFP", "(Reuters)"). No AI, see `services/utils/corroboration.js`. |
| `says "reportedly"` | the words the article itself used to say it has no confirmation (`services/utils/hedging.js`). It reports how the article presents itself, and the article's own words are shown rather than a label. Conditionals are left out: French and Italian use them for ordinary reported speech. |
| `named` / `unnamed` / `no source given` | who the article credits, answered by the AI in the call that picks the key passages, so it costs no extra call. It describes the article, never the truth of the news: an official statement can be a lie and an unnamed source can be right. |

A group of one medium says `Only one medium`, which is the honest answer and not a warning. The
labels are written by the client (`client/src/features/briefing/corroboration.js`), the same on the
cards of the briefing and of the search; "different" and not "independent" since 15.10.2026: a wire
reworded counts as another text.

**From ten articles, the card stops claiming to be one news** and says `Told by N media: a running story`.
It is a safety net that nothing reaches today: the largest true group measured holds eight
articles, and nothing between nine and eleven exists at all. It used to be five, when the grouping
chained (see below) and a card could hold thirty-one articles from a court filing to the late-night
jokes about it.


## See also

- [Briefing](../README.md): the cards this is shown on.
- [Other angles](../other-angles/README.md) and [Denials](../denials/README.md): what else a card says about how it is told.
- [Key passages](../../search/key-passages/README.md): the article read for the texts compared here.
