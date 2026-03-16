import Links from "../services/links.js";

test('get one category link', () => {
    // Given
    const category = ["world"];
    const result = [
        "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
        "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
        "https://abcnews.go.com/abcnews/internationalheadlines",
        "https://www.youtube.com/feeds/videos.xml?playlist_id=PLQOa26lW-uI9Ja7WDOHBJecZXTC9fm__C"
    ];

    // When & Then
    expect(Links.getCategoriesLinks(category)).toEqual(result);
});

test('get multiple category links', () => {
    // Given
    const category = ["world", "press", "sport"];
    const result = [
        "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
        "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
        "https://abcnews.go.com/abcnews/internationalheadlines",
        "https://www.youtube.com/feeds/videos.xml?playlist_id=PLQOa26lW-uI9Ja7WDOHBJecZXTC9fm__C",
        "https://www.404media.co/rss/",
        "https://abcnews.go.com/abcnews/internationalheadlines",
        "https://www.wfmz.com/search/?f=rss&t=article&c=sports&l=50&s=start_time&sd=desc",
        "https://abcnews.go.com/abcnews/sportsheadlines",

    ];

    // When & Then
    expect(Links.getCategoriesLinks(category)).toEqual(result);
});

test('get non-existent category links', () => {
    // Given
    const category = ["technology"];
    const result = "None of theses categories were found: technology";

    // When & Then
    expect(() => Links.getCategoriesLinks(category)).toThrow(result);
});

test('get existent and non-existent category links', () => {
    // Given
    const category = ["technology", "world"];
    const result = [
        "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
        "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
        "https://abcnews.go.com/abcnews/internationalheadlines",
        "https://www.youtube.com/feeds/videos.xml?playlist_id=PLQOa26lW-uI9Ja7WDOHBJecZXTC9fm__C"
    ];

    // When & Then
    expect(Links.getCategoriesLinks(category)).toEqual(result);
});