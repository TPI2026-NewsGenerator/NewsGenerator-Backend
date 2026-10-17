# Diagrams

<!-- Written by docs-site/diagrams.mjs (run.mjs runs it before the site): change the diagrams, not this page. -->

Every diagram of the docs in one place. Each one stays in the folder of its feature, next to the text that
explains it (its `.puml` source has the same name as its `.png`): this page only lists them, to find one
without knowing its feature, or to read all the diagrams of one kind.

## The whole system

| Diagram | What it shows |
|---|---|
| [00-overview](a-to-z/00-overview.png) | Backend — the features and what links them (16.10.2026) |
| [31-deployment](a-to-z/31-deployment.png) | Deployment — the machines, the containers and the services outside |
| [32-a-to-z](a-to-z/32-a-to-z.png) | NewsGenerator from A to Z — the background work, then one reader |
| [30-database](database/30-database.png) | Database — the 24 tables (PostgreSQL 18 + pgvector) |

## The features

A class diagram (what each part holds and calls) and a sequence diagram (one use, step by step) for
each feature and each of its parts. Other: the diagrams of the first sprints, kept where they were.

| Feature | Class | Sequence | Other |
|---|---|---|---|
| [Accounts](accounts/README.md) | [01-accounts](accounts/01-accounts.png) | [20-signup-sequence](accounts/20-signup-sequence.png) | [login-sequence-diagram](accounts/login-sequence-diagram.png) |
| [Accounts > Signup](accounts/signup/README.md) | [accounts-signup-class](accounts/signup/accounts-signup-class.png) | [accounts-signup-sequence](accounts/signup/accounts-signup-sequence.png) | · |
| [Accounts > Login and session](accounts/login-and-session/README.md) | [accounts-login-and-session-class](accounts/login-and-session/accounts-login-and-session-class.png) | [accounts-login-and-session-sequence](accounts/login-and-session/accounts-login-and-session-sequence.png) | · |
| [Accounts > Settings](accounts/settings/README.md) | [accounts-settings-class](accounts/settings/accounts-settings-class.png) | [accounts-settings-sequence](accounts/settings/accounts-settings-sequence.png) | · |
| [Profile](profile/README.md) | [06-profile](profile/06-profile.png) | [25-profile-sequence](profile/25-profile-sequence.png) | · |
| [Profile > AI questions](profile/ai-questions/README.md) | [profile-ai-questions-class](profile/ai-questions/profile-ai-questions-class.png) | [profile-ai-questions-sequence](profile/ai-questions/profile-ai-questions-sequence.png) | · |
| [Profile > Interests](profile/interests/README.md) | [profile-interests-class](profile/interests/profile-interests-class.png) | [profile-interests-sequence](profile/interests/profile-interests-sequence.png) | · |
| [Profile > Projects](profile/projects/README.md) | [profile-projects-class](profile/projects/profile-projects-class.png) | [profile-projects-sequence](profile/projects/profile-projects-sequence.png) | · |
| [Profile > Several profiles](profile/several-profiles/README.md) | [profile-several-profiles-class](profile/several-profiles/profile-several-profiles-class.png) | [profile-several-profiles-sequence](profile/several-profiles/profile-several-profiles-sequence.png) | · |
| [Sources](sources/README.md) | [05-sources](sources/05-sources.png) | · | · |
| [Sources > Discovery](sources/discovery/README.md) | [07-discovery](sources/discovery/07-discovery.png) | [23-discovery-sequence](sources/discovery/23-discovery-sequence.png) | · |
| [Sources > Added by hand](sources/added-by-hand/README.md) | [sources-added-by-hand-class](sources/added-by-hand/sources-added-by-hand-class.png) | [sources-added-by-hand-sequence](sources/added-by-hand/sources-added-by-hand-sequence.png) | · |
| [Sources > Recommended](sources/recommended/README.md) | [sources-recommended-class](sources/recommended/sources-recommended-class.png) | [sources-recommended-sequence](sources/recommended/sources-recommended-sequence.png) | · |
| [Sources > Missing sources](sources/missing-sources/README.md) | [sources-missing-sources-class](sources/missing-sources/sources-missing-sources-class.png) | [sources-missing-sources-sequence](sources/missing-sources/sources-missing-sources-sequence.png) | · |
| [Sources > Trusted and thumbs](sources/trusted-and-thumbs/README.md) | [sources-trusted-and-thumbs-class](sources/trusted-and-thumbs/sources-trusted-and-thumbs-class.png) | [sources-trusted-and-thumbs-sequence](sources/trusted-and-thumbs/sources-trusted-and-thumbs-sequence.png) | · |
| [Ingestion](ingestion/README.md) | [04-ingestion](ingestion/04-ingestion.png) | [24-ingestion-sequence](ingestion/24-ingestion-sequence.png) | · |
| [Ingestion > Feeds](ingestion/feeds/README.md) | [ingestion-feeds-class](ingestion/feeds/ingestion-feeds-class.png) | [ingestion-feeds-sequence](ingestion/feeds/ingestion-feeds-sequence.png) | · |
| [Ingestion > Vectors](ingestion/vectors/README.md) | [ingestion-vectors-class](ingestion/vectors/ingestion-vectors-class.png) | [ingestion-vectors-sequence](ingestion/vectors/ingestion-vectors-sequence.png) | · |
| [Ingestion > Stories and threads](ingestion/stories-and-threads/README.md) | [ingestion-stories-and-threads-class](ingestion/stories-and-threads/ingestion-stories-and-threads-class.png) | [ingestion-stories-and-threads-sequence](ingestion/stories-and-threads/ingestion-stories-and-threads-sequence.png) | · |
| [Ingestion > Names](ingestion/names/README.md) | [ingestion-names-class](ingestion/names/ingestion-names-class.png) | [ingestion-names-sequence](ingestion/names/ingestion-names-sequence.png) | · |
| [Ingestion > Directory](ingestion/directory/README.md) | [ingestion-directory-class](ingestion/directory/ingestion-directory-class.png) | [ingestion-directory-sequence](ingestion/directory/ingestion-directory-sequence.png) | · |
| [Search](search/README.md) | [03-search](search/03-search.png) | [21-search-sequence](search/21-search-sequence.png) | · |
| [Search > Search by meaning](search/search-by-meaning/README.md) | [search-by-meaning-class](search/search-by-meaning/search-by-meaning-class.png) | [search-by-meaning-sequence](search/search-by-meaning/search-by-meaning-sequence.png) | · |
| [Search > Keywords](search/keywords/README.md) | [search-keywords-class](search/keywords/search-keywords-class.png) | [search-keywords-sequence](search/keywords/search-keywords-sequence.png) | · |
| [Search > Key passages](search/key-passages/README.md) | [search-key-passages-class](search/key-passages/search-key-passages-class.png) | [search-key-passages-sequence](search/key-passages/search-key-passages-sequence.png) | · |
| [Search > Translations](search/translations/README.md) | [search-translations-class](search/translations/search-translations-class.png) | [search-translations-sequence](search/translations/search-translations-sequence.png) | · |
| [Search > Saved searches](search/saved-searches/README.md) | [02-saved-searches](search/saved-searches/02-saved-searches.png) | [search-saved-searches-sequence](search/saved-searches/search-saved-searches-sequence.png) | [search-history-delete-diagram](search/saved-searches/search-history-delete-diagram.png)<br>[search-history-edit-diagram](search/saved-searches/search-history-edit-diagram.png)<br>[search-history-get-diagram](search/saved-searches/search-history-get-diagram.png)<br>[search-history-save-diagram](search/saved-searches/search-history-save-diagram.png) |
| [Briefing](briefing/README.md) | [08-briefing](briefing/08-briefing.png)<br>[08b-briefing-cards](briefing/08b-briefing-cards.png) | [22-briefing-sequence](briefing/22-briefing-sequence.png) | · |
| [Briefing > Key passages](briefing/key-passages/README.md) | [briefing-key-passages-class](briefing/key-passages/briefing-key-passages-class.png) | [briefing-key-passages-sequence](briefing/key-passages/briefing-key-passages-sequence.png) | · |
| [Briefing > Summary](briefing/summary/README.md) | [briefing-summary-class](briefing/summary/briefing-summary-class.png) | [briefing-summary-sequence](briefing/summary/briefing-summary-sequence.png) | · |
| [Briefing > Summary (IA)](briefing/summary/summary-ia/README.md) | [briefing-summary-ia-class](briefing/summary/summary-ia/briefing-summary-ia-class.png) | [briefing-summary-ia-sequence](briefing/summary/summary-ia/briefing-summary-ia-sequence.png) | · |
| [Briefing > Bullet points](briefing/bullet-points/README.md) | [briefing-bullet-points-class](briefing/bullet-points/briefing-bullet-points-class.png) | [briefing-bullet-points-sequence](briefing/bullet-points/briefing-bullet-points-sequence.png) | · |
| [Briefing > Bullet points (IA)](briefing/bullet-points/bullet-points-ia/README.md) | [briefing-bullet-points-ia-class](briefing/bullet-points/bullet-points-ia/briefing-bullet-points-ia-class.png) | [briefing-bullet-points-ia-sequence](briefing/bullet-points/bullet-points-ia/briefing-bullet-points-ia-sequence.png) | · |
| [Briefing > Analysis (IA)](briefing/analysis-ia/README.md) | [briefing-analysis-ia-class](briefing/analysis-ia/briefing-analysis-ia-class.png) | [briefing-analysis-ia-sequence](briefing/analysis-ia/briefing-analysis-ia-sequence.png) | · |
| [Briefing > Official source](briefing/official-source/README.md) | [briefing-official-source-class](briefing/official-source/briefing-official-source-class.png) | [briefing-official-source-sequence](briefing/official-source/briefing-official-source-sequence.png) | · |
| [Briefing > Other angles](briefing/other-angles/README.md) | [briefing-other-angles-class](briefing/other-angles/briefing-other-angles-class.png) | [briefing-other-angles-sequence](briefing/other-angles/briefing-other-angles-sequence.png) | · |
| [Briefing > Denials](briefing/denials/README.md) | [briefing-denials-class](briefing/denials/briefing-denials-class.png) | [briefing-denials-sequence](briefing/denials/briefing-denials-sequence.png) | · |
| [Briefing > Thumbs](briefing/thumbs/README.md) | [briefing-thumbs-class](briefing/thumbs/briefing-thumbs-class.png) | [briefing-thumbs-sequence](briefing/thumbs/briefing-thumbs-sequence.png) | · |
| [Briefing > News by link](briefing/news-by-link/README.md) | [briefing-news-by-link-class](briefing/news-by-link/briefing-news-by-link-class.png) | [briefing-news-by-link-sequence](briefing/news-by-link/briefing-news-by-link-sequence.png) | · |
| [Briefing > Email](briefing/email/README.md) | [09-email](briefing/email/09-email.png) | [26-email-sequence](briefing/email/26-email-sequence.png) | · |
| [Following](following/README.md) | [10-following](following/10-following.png) | [27-following-sequence](following/27-following-sequence.png) | · |
| [Following > Wikidata items](following/wikidata-items/README.md) | [following-wikidata-items-class](following/wikidata-items/following-wikidata-items-class.png) | [following-wikidata-items-sequence](following/wikidata-items/following-wikidata-items-sequence.png) | · |
| [Following > Names and words](following/names-and-words/README.md) | [following-names-and-words-class](following/names-and-words/following-names-and-words-class.png) | [following-names-and-words-sequence](following/names-and-words/following-names-and-words-sequence.png) | · |
| [Following > Names on cards](following/names-on-cards/README.md) | [following-names-on-cards-class](following/names-on-cards/following-names-on-cards-class.png) | [following-names-on-cards-sequence](following/names-on-cards/following-names-on-cards-sequence.png) | · |

## The client

The pages and components of the client, by feature, and its use cases.

| Feature | Class | Sequence | Other |
|---|---|---|---|
| Accounts | [client-01-accounts](../../client/docs/accounts/client-01-accounts.png) | · | [login-sequence-diagram](../../client/docs/accounts/login-sequence-diagram.png)<br>[login_get_user-sequence-diagram](../../client/docs/accounts/login_get_user-sequence-diagram.png)<br>[login_logout-sequence-diagram](../../client/docs/accounts/login_logout-sequence-diagram.png) |
| Briefing | [client-04-briefing](../../client/docs/briefing/client-04-briefing.png) | [client-20-briefing-sequence](../../client/docs/briefing/client-20-briefing-sequence.png) | · |
| Briefing > Email | [client-05-email](../../client/docs/briefing/email/client-05-email.png) | [client-21-email-sequence](../../client/docs/briefing/email/client-21-email-sequence.png) | · |
| Following | [client-06-following](../../client/docs/following/client-06-following.png) | · | · |
| Profile | [client-03-profiles](../../client/docs/profile/client-03-profiles.png) | · | · |
| Search | [client-02-search](../../client/docs/search/client-02-search.png) | · | · |
| Search > Saved searches | · | · | [search-history-diagram_create_mod](../../client/docs/search/saved-searches/search-history-diagram_create_mod.png)<br>[search-history-diagram_delete](../../client/docs/search/saved-searches/search-history-diagram_delete.png)<br>[search-history-diagram_get](../../client/docs/search/saved-searches/search-history-diagram_get.png) |
| Use cases | · | · | [use-case-diagram](../../client/docs/use-cases/use-case-diagram.png) |

## Archive

The MCD, MLD, class and use case diagrams of sprints 1 to 3, kept as they were.

- [class-diagram-sprint1](archive/class-diagram-sprint1.png)
- [class-diagram-sprint2](archive/class-diagram-sprint2.png)
- [class-diagram-sprint3](archive/class-diagram-sprint3.png)
- [class-diagram](archive/class-diagram.puml)
- [newsgenerator-mcd-sprint1](archive/newsgenerator-mcd-sprint1.png)
- [newsgenerator-mcd-sprint2](archive/newsgenerator-mcd-sprint2.png)
- [newsgenerator-mcd-sprint3](archive/newsgenerator-mcd-sprint3.png)
- [newsgenerator-mld-sprint1](archive/newsgenerator-mld-sprint1.png)
- [newsgenerator-mld-sprint2](archive/newsgenerator-mld-sprint2.png)
- [newsgenerator-mld-sprint3](archive/newsgenerator-mld-sprint3.png)
- [use-case-diagram-planned](../../client/docs/archive/use-case-diagram-planned.png)
- [use-case-diagram-sprint1](../../client/docs/archive/use-case-diagram-sprint1.png)
- [use-case-diagram-sprint2](../../client/docs/archive/use-case-diagram-sprint2.png)
- [use-case-diagram-sprint3](../../client/docs/archive/use-case-diagram-sprint3.png)
- [user-preferences-diagram](../../client/docs/archive/user-preferences-diagram.png)
