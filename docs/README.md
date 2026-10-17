# Documentation of the server

Where to start: **[`a-to-z/parcours-newsgenerator.md`](a-to-z/parcours-newsgenerator.md)** (in French) tells how
the whole system works, from the account of a reader to the card they read, every step with its mechanism and
its technology. Then each feature has a folder, and each part of it a folder of its own: a `README.md` that says
what it does and how, a class diagram and a sequence diagram (source `.puml` and `.png`). All the diagrams, by
feature and by kind, are listed in **[`diagrams.md`](diagrams.md)**.

The client's diagrams (its use cases, and its pages and components by feature) are in
[`../../client/docs/`](../../client/docs/README.md). Every route of the API, with its body and its answers, is
in Swagger: `http://localhost:3001/docs` (`config/swagger.js`).

## The whole system

| Folder | What |
|---|---|
| `a-to-z/` | [`parcours-newsgenerator.md`](a-to-z/parcours-newsgenerator.md) ([`.html`](a-to-z/parcours-newsgenerator.html)), the walk of a reader; [`parcours-d-une-nouvelle.md`](a-to-z/parcours-d-une-nouvelle.md) ([`.html`](a-to-z/parcours-d-une-nouvelle.html)), one news from the page of its medium to a card; [`32-a-to-z`](a-to-z/32-a-to-z.png), the same as one diagram; [`00-overview`](a-to-z/00-overview.png), the features and what links them; [`31-deployment`](a-to-z/31-deployment.png), the machines |
| `database/` | [`mld.md`](database/mld.md), the 24 tables, their columns, keys and SQL functions; [`30-database`](database/30-database.png), the same as a diagram |
| `archive/` | the MCD, MLD and class diagrams of sprints 1 to 3, kept as they were |
| `_style/` | the style every class (`class.iuml`) and sequence (`sequence.iuml`) diagram includes |
| [`tools.md`](tools.md) | every tool, its version, what it is for, where it is in the code and which parts of these docs explain it |

## The features

- **[Accounts](accounts/README.md)**: [Signup](accounts/signup/README.md) · [Login and session](accounts/login-and-session/README.md) · [Settings](accounts/settings/README.md)
- **[Profile](profile/README.md)**: [AI questions](profile/ai-questions/README.md) · [Interests](profile/interests/README.md) · [Projects](profile/projects/README.md) · [Several profiles](profile/several-profiles/README.md)
- **[Sources](sources/README.md)**: [Discovery](sources/discovery/README.md) · [Added by hand](sources/added-by-hand/README.md) · [Recommended](sources/recommended/README.md) · [Missing sources](sources/missing-sources/README.md) · [Trusted and thumbs](sources/trusted-and-thumbs/README.md)
- **[Ingestion](ingestion/README.md)** (the background work): [Feeds](ingestion/feeds/README.md) · [Vectors](ingestion/vectors/README.md) · [Stories and threads](ingestion/stories-and-threads/README.md) · [Names](ingestion/names/README.md) · [Directory](ingestion/directory/README.md)
- **[Search](search/README.md)**: [Search by meaning](search/search-by-meaning/README.md) · [Keywords](search/keywords/README.md) · [Key passages](search/key-passages/README.md) · [Translations](search/translations/README.md) · [Saved searches](search/saved-searches/README.md)
- **[Briefing](briefing/README.md)**:
  - how a card reads: [Key passages](briefing/key-passages/README.md) · [Summary](briefing/summary/README.md) > [Summary (IA)](briefing/summary/summary-ia/README.md) · [Bullet points](briefing/bullet-points/README.md) > [Bullet points (IA)](briefing/bullet-points/bullet-points-ia/README.md)
  - what a card adds: [Analysis (IA)](briefing/analysis-ia/README.md) · [Official source](briefing/official-source/README.md) · [Other angles](briefing/other-angles/README.md) · [Denials](briefing/denials/README.md)
  - what the reader does with it: [Thumbs](briefing/thumbs/README.md) · [News by link](briefing/news-by-link/README.md) · [Email](briefing/email/README.md)
- **[Following](following/README.md)**: [Wikidata items](following/wikidata-items/README.md) · [Names and words](following/names-and-words/README.md) · [Names on cards](following/names-on-cards/README.md)

A card shows one way of reading at a time, chosen by the reader: Key passages, Summary or Bullet points, all
three made of the article's own sentences. The AI version of a Summary or of Bullet points is an extra, shown
on demand under them.

## Render the diagrams

From `server/`, one folder at a time (PlantUML and Graphviz):

```bash
java -jar plantuml.jar -charset UTF-8 "docs/briefing/summary/summary-ia/*.puml"
```
