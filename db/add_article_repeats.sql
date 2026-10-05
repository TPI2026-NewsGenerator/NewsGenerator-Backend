--
--  Author: Fabian Rostello
--  Date: 05.10.2026
--  File: add_article_repeats.sql
--  Description: The news a feed gives again under another link (same title, same date of publication)
--               are found by their feed and their date before they are saved (see FeedModel.withoutRepeats)
--

CREATE INDEX IF NOT EXISTS i_articles_feed_published ON public.articles (id_feed, published_at);
