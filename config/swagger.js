//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: swagger.js
//  Description: Swagger documentation
//

import swaggerJSDoc from 'swagger-jsdoc';
import process from 'node:process'
import 'dotenv/config';

const port = process.env.PORT || 3000;

const options = {
    definition: {
        "openapi": "3.0.3",
        "info": {
            "title": "News Generator API",
            "version": "1.0.0",
            "description": "API for retrieving, filtering, and summarizing news based on user-defined parameters including keywords, topics, and temporal constraints."
        },
        "servers": [
            {
                "url": `http://localhost:${port}/api`,
                "description": "Local development server"
            }
        ],
        "tags": [
            {
                "name": "Login",
                "description": "Authentication, every other route needs the token it returns"
            },
            {
                "name": "News",
                "description": "Operations related to news retrieval and processing"
            },
            {
                "name": "Feeds",
                "description": "Sources added by a user, private to them, and the media a search is missing"
            },
            {
                "name": "Custom searches",
                "description": "Searches a user saved to run them again"
            }
        ],
        // every route but /login needs the token, so it is asked once at the top of the page
        "security": [{"bearerAuth": []}],
        "paths": {
            "/login": {
                "post": {
                    "tags": ["Login"],
                    "summary": "Sign in and get a token",
                    "security": [],
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "username": {"type": "string"},
                                        "password": {"type": "string", "format": "password"}
                                    },
                                    "required": ["username", "password"]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": {
                            "description": "The user and the token to send as `Authorization: Bearer <token>`",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "id_user": {"type": "integer"},
                                            "token": {"type": "string"}
                                        }
                                    }
                                }
                            }
                        },
                        "400": {"description": "Username or password missing"},
                        "401": {"description": "Wrong password"},
                        "404": {"description": "No such user"}
                    }
                }
            },
            "/news": {
                "post": {
                    "tags": [
                        "News"
                    ],
                    "summary": "Fetch and summarize personalized news",
                    "description": "Retrieves news articles matching specific criteria and returns AI-generated summaries based on user preferences.",
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/NewsRequest"
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": {
                            "description": "Successfully retrieved news and summarized if asked.",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "$ref": "#/components/schemas/NewsResponse"
                                    }
                                }
                            }
                        },
                        "400": {
                            "description": "Bad Request"
                        },
                        "500": {
                            "description": "Internal Server Error"
                        }
                    }
                }
            },
            "/feeds": {
                "get": {
                    "tags": ["Feeds"],
                    "summary": "Sources added by the user",
                    "description": "Private: the user comes from the token, a user only sees their own sources.",
                    "responses": {"200": {"description": "List of the sources of this user"}}
                },
                "post": {
                    "tags": ["Feeds"],
                    "summary": "Add a source from the address of a website",
                    "description": "The server finds the RSS feed of the site (declared in its page or at the usual paths) and keeps it only if it answers with news. Private addresses are refused (SSRF), 20 sources maximum per user.",
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "site": {"type": "string", "example": "engadget.com"},
                                        "category": {"type": "string", "example": "technology"},
                                        "language": {"type": "string", "example": "en", "description": "Steers the choice of the section when the feed has to be built from the page (step 4)."}
                                    },
                                    "required": ["site", "category"]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": {"description": "Source added, with a sample of its news"},
                        "400": {"description": "No feed found, private address, unknown category, already added or too many sources"}
                    }
                }
            },
            "/feeds/suggestions": {
                "post": {
                    "tags": ["Feeds"],
                    "summary": "The media covering this search that are missing from the sources",
                    "description": "The keywords of the search are asked to Google News and to GDELT. Answers the news of the media that are not searched, **read only** (their link goes through a Google redirect, so the server can neither scrape nor summarize them), and those media with the feed to add for each. `missing` is how many media are missing in all, `tried` how many of them a feed was looked for: only the most present ones are tried, because the user is waiting.",
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "keywords": {"type": "array", "items": {"type": "string"}, "example": ["referee"]},
                                        "language": {"type": "string", "example": "en"},
                                        "timeframe": {
                                            "type": "object",
                                            "properties": {
                                                "start": {"type": "string", "format": "date-time"},
                                                "end": {"type": "string", "format": "date-time"}
                                            }
                                        }
                                    },
                                    "required": ["keywords"]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": {
                            "description": "What this search missed",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "news": {
                                                "type": "array",
                                                "description": "News of the media that are not searched, for reading only",
                                                "items": {
                                                    "type": "object",
                                                    "properties": {
                                                        "title": {"type": "string"},
                                                        "url": {"type": "string", "format": "uri"},
                                                        "site": {"type": "string"},
                                                        "name": {"type": "string"},
                                                        "publishedAt": {"type": "string", "format": "date-time", "nullable": true}
                                                    }
                                                }
                                            },
                                            "sources": {
                                                "type": "array",
                                                "description": "The missing media whose feed was found, ready to be imported",
                                                "items": {"$ref": "#/components/schemas/SuggestedSource"}
                                            },
                                            "missing": {"type": "integer", "description": "How many media are missing in all"},
                                            "tried": {"type": "integer", "description": "How many of them a feed was looked for"}
                                        }
                                    }
                                }
                            }
                        },
                        "400": {"description": "No keyword given"},
                        "502": {"description": "Google News did not answer"}
                    }
                }
            },
            "/feeds/search": {
                "post": {
                    "tags": ["Feeds"],
                    "summary": "Search a directory of feeds, by subject or by site",
                    "description": "Asks a public directory for the feeds matching a subject (\"premier league\") or a site, the most read first, without the media this user already searches. Nothing is checked here: the feeds are read when they are imported.",
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {"query": {"type": "string", "example": "premier league"}},
                                    "required": ["query"]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": {
                            "description": "Feeds of the directory",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "sources": {"type": "array", "items": {"$ref": "#/components/schemas/SuggestedSource"}}
                                        }
                                    }
                                }
                            }
                        },
                        "400": {"description": "No subject given"}
                    }
                }
            },
            "/feeds/import": {
                "post": {
                    "tags": ["Feeds"],
                    "summary": "Add several suggested sources at once",
                    "description": "Each feed is read again here: what the client sends back is never trusted, it could be any address, and a directory can name a feed that died. A source suggested from the RSS-Bridge is a special case: its address is **rebuilt from the name of the site** rather than taken from the request, because the bridge runs on this machine and a crafted address could point it anywhere. A source that fails does not stop the others, it is returned in `errors`.",
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "sources": {
                                            "type": "array",
                                            "items": {
                                                "type": "object",
                                                "properties": {
                                                    "site": {"type": "string", "example": "skysports.com"},
                                                    "feed": {"type": "string", "format": "uri"},
                                                    "category": {"type": "string", "example": "sport"}
                                                },
                                                "required": ["site", "feed", "category"]
                                            }
                                        },
                                        "language": {"type": "string", "example": "en", "description": "Steers which section of a site is read when its feed has to be rebuilt from the page."}
                                    },
                                    "required": ["sources"]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": {
                            "description": "The sources added, and why the others were not",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "feeds": {"type": "array", "items": {"type": "object"}},
                                            "errors": {
                                                "type": "array",
                                                "items": {
                                                    "type": "object",
                                                    "properties": {
                                                        "site": {"type": "string"},
                                                        "error": {"type": "string"}
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        "400": {"description": "No source selected"}
                    }
                }
            },
            "/feeds/{id}": {
                "delete": {
                    "tags": ["Feeds"],
                    "summary": "Remove one of the sources of the user",
                    "parameters": [{"name": "id", "in": "path", "required": true, "schema": {"type": "integer"}}],
                    "responses": {"200": {"description": "Removed"}, "404": {"description": "Not a source of this user"}}
                }
            },
            "/news/categories": {
                "get": {
                    "tags": [
                        "News"
                    ],
                    "summary": "Categories and languages that can be searched",
                    "description": "Both come from the feeds list (db/rss-links.js). The categories are those of the language asked: world, press, sport, politics, economy, technology, science.",
                    "security": [],
                    "parameters": [{
                        "name": "language",
                        "in": "query",
                        "required": false,
                        "schema": {"type": "string", "default": "en"},
                        "description": "Language whose categories are wanted, English when it is not given"
                    }],
                    "responses": {
                        "200": {
                            "description": "Categories of this language, and every language that has sources",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "categories": {
                                                "type": "array",
                                                "items": {
                                                    "type": "string"
                                                }
                                            },
                                            "languages": {
                                                "type": "array",
                                                "items": {"type": "string"},
                                                "example": ["en", "fr", "es", "de", "it"]
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/news/content": {
                "post": {
                    "tags": [
                        "News"
                    ],
                    "summary": "Scrape the full content of the selected news",
                    "description": "Scrapes the pages of the news selected by the user (10 max). Only urls returned by POST /news are accepted. When a page can't be read (paywall, 403...), the RSS description is returned as content and fullContent is false.",
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "urls": {
                                            "type": "array",
                                            "maxItems": 10,
                                            "items": {
                                                "type": "string",
                                                "format": "uri"
                                            }
                                        }
                                    },
                                    "required": [
                                        "urls"
                                    ]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": {
                            "description": "Content of the selected news, in the same order as asked.",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "$ref": "#/components/schemas/NewsResponse"
                                    }
                                }
                            }
                        },
                        "400": {
                            "description": "No url, more than 10 urls, or url not found in the news cache"
                        },
                        "500": {
                            "description": "Internal Server Error"
                        }
                    }
                }
            },
            "/news/summary": {
                "post": {
                    "tags": [
                        "News"
                    ],
                    "summary": "AI resume of the selected news",
                    "description": "Scrapes the selected news (10 max, like POST /news/content), then asks the AI for a resume of 120 to 150 words and the topic of the news. The resume is kept, so asking twice costs nothing. News that could not be scraped get no resume: summary is null and summaryError explains why.",
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "urls": {
                                            "type": "array",
                                            "maxItems": 10,
                                            "items": {
                                                "type": "string",
                                                "format": "uri"
                                            }
                                        }
                                    },
                                    "required": [
                                        "urls"
                                    ]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": {
                            "description": "Selected news with their resume, in the same order as asked.",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "$ref": "#/components/schemas/NewsResponse"
                                    }
                                }
                            }
                        },
                        "400": {
                            "description": "No url, more than 10 urls, or url not found in the news cache"
                        },
                        "500": {
                            "description": "Internal Server Error"
                        }
                    }
                }
            },
            "/customsearch": {
                "get": {
                    "tags": ["Custom searches"],
                    "summary": "The searches this user saved",
                    "description": "Private: the user comes from the token, a user only ever sees their own searches.",
                    "responses": {
                        "200": {
                            "description": "The saved searches, with their categories",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "array",
                                        "items": {"$ref": "#/components/schemas/CustomSearch"}
                                    }
                                }
                            }
                        }
                    }
                },
                "post": {
                    "tags": ["Custom searches"],
                    "summary": "Save a search, or change one already saved",
                    "description": "Without `id` the search is created, with it the search of that id is replaced. A user cannot have two searches with the same title.",
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/CustomSearch"}
                            }
                        }
                    },
                    "responses": {
                        "200": {"description": "The search as it was saved"},
                        "400": {"description": "Title, keyword, language or category missing, or that title is already used"}
                    }
                },
                "delete": {
                    "tags": ["Custom searches"],
                    "summary": "Remove one of the saved searches",
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {"id": {"type": "integer"}},
                                    "required": ["id"]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": {"description": "Removed"},
                        "400": {"description": "No id given, or not a search of this user"}
                    }
                }
            }
        },
        "components": {
            "schemas": {
                "NewsRequest": {
                    "type": "object",
                    "properties": {
                        "keywords": {
                            "type": "array",
                            "description": "Terms searched in the title, description and RSS categories. Commas separate alternatives (OR), the words of an alternative must all be found (AND). \"Quoted text\" is an exact word or phrase, other words also find their variants (referee -> referees). Words of 3 letters or less (VAR, NFL) are whole words.",
                            "items": {
                                "type": "string"
                            },
                            "example": [
                                "referee, \"red card\""
                            ]
                        },
                        "categories": {
                            "type": "array",
                            "description": "General news topics or domains.",
                            "items": {
                                "type": "string"
                            },
                            "example": [
                                "world",
                                "press"
                            ]
                        },
                        "language": {
                            "type": "string",
                            "description": "ISO 639-1 language code. A search never mixes two languages: only the feeds of this language are read. GET /news/categories answers the ones that have sources.",
                            "enum": ["en", "fr", "es", "de", "it"],
                            "example": "en",
                            "default": "en"
                        },
                        "timeframe": {
                            "type": "object",
                            "description": "News published in this range, on the date given by the feed (or the date the news was first seen when the feed gives none). Both bounds are optional: only start means \"not older than\".",
                            "properties": {
                                "start": {
                                    "type": "string",
                                    "format": "date-time"
                                },
                                "end": {
                                    "type": "string",
                                    "format": "date-time"
                                }
                            }
                        }
                    },
                    "required": [
                        "keywords",
                        "categories"
                    ]
                },
                "NewsResponse": {
                    "type": "object",
                    "properties": {
                        "totalResults": {
                            "type": "integer"
                        },
                        "news": {
                            "type": "array",
                            "items": {
                                "$ref": "#/components/schemas/Article"
                            }
                        },
                        "wider": {
                            "type": "object",
                            "nullable": true,
                            "description": "Only in POST /news, and only when the search found fewer than 5 news while asking for several words at once. It is an offer, not something already done: the same search asking for *any* of the words would have found `found` news. Widening is left to the user because it can answer anything, `red card` alone would return everything about red or about card.",
                            "properties": {
                                "found": {"type": "integer", "description": "How many news the wider search finds"},
                                "terms": {"type": "array", "items": {"type": "string"}, "description": "The words it would look for, one at a time"}
                            }
                        }
                    },
                    // "required": [
                    //     "totalResults",
                    //     "articles"
                    // ]
                },
                "Article": {
                    "type": "object",
                    "properties": {
                        "url": {
                            "type": "string",
                            "format": "uri"
                        },
                        "source": {
                            "type": "string"
                        },
                        "publishedAt": {
                            "type": "string",
                            "format": "date-time"
                        },
                        "title": {
                            "type": "string"
                        },
                        "author": {
                            "type": "string"
                        },
                        "lang": {
                            "type": "string",
                            "description": "News language."
                        },
                        "description": {
                            "type": "string",
                            "description": "A brief description of the news."
                        },
                        "thumbnail": {
                            "type": "string",
                            "format": "uri",
                            "nullable": true
                        },
                        "content": {
                            "type": "string",
                            "description": "The raw news content (only in POST /news/content)."
                        },
                        "topic": {
                            "type": "string",
                            "nullable": true,
                            "description": "Topic given by the AI with the resume, null while the news has no resume."
                        },
                        "sourcing": {
                            "type": "string",
                            "nullable": true,
                            "enum": ["named", "anonymous", "none"],
                            "description": "Who the article credits for what it reports, answered by the AI with the resume, so it costs no extra call. It describes the article, never whether the news is true: an official statement can be a lie and an unnamed source can be right. Null while the news has no resume."
                        },
                        "hedged": {
                            "type": "string",
                            "nullable": true,
                            "description": "The words the article itself used to say it has no confirmation (\"reportedly\", \"selon des sources\"...), null when it states its news plainly. Read from the title and the description, no AI involved.",
                            "example": "reportedly"
                        },
                        "corroboration": {
                            "type": "object",
                            "description": "How widely this news is carried (only in POST /news). It says what was counted, never that the news is true: a rumour repeated by twenty sites is still a rumour.",
                            "properties": {
                                "media": {
                                    "type": "integer",
                                    "description": "Different media telling this news, counted per medium and not per feed."
                                },
                                "wordings": {
                                    "type": "integer",
                                    "description": "How many of them wrote their own headline. A wire of Reuters republished by twenty sites gives 20 media but 1 wording: one report seen twenty times, not twenty confirmations. Never above `media`."
                                }
                            }
                        },
                        "sources": {
                            "type": "array",
                            "description": "Other news telling the same story, grouped (only in POST /news).",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "url": {"type": "string", "format": "uri"},
                                    "source": {"type": "string"},
                                    "title": {"type": "string"},
                                    "publishedAt": {"type": "string", "format": "date-time"}
                                }
                            }
                        },
                        "fullContent": {
                            "type": "boolean",
                            "description": "False when the page could not be scraped and content is the RSS description (only in POST /news/content)."
                        },
                        "summary": {
                            "type": "string",
                            "nullable": true,
                            "description": "The AI resume, 120 to 150 words (only in POST /news/summary)."
                        },
                        "summaryError": {
                            "type": "string",
                            "nullable": true,
                            "description": "Why there is no resume (only in POST /news/summary)."
                        }
                    },
                    // "required": [
                    //     "title",
                    //     "summary",
                    //     "originalUrl"
                    // ]
                },
                "CustomSearch": {
                    "type": "object",
                    "description": "A search saved by a user to run it again.",
                    "properties": {
                        "id": {"type": "integer", "description": "Left out when the search is created"},
                        "title": {"type": "string", "example": "Refereeing"},
                        "keyword": {"type": "string", "example": "referee, \"red card\""},
                        "language": {"type": "string", "example": "en"},
                        "category": {
                            "type": "array",
                            "items": {"type": "string"},
                            "example": ["sport"]
                        }
                    },
                    "required": ["title", "keyword", "language", "category"]
                },
                "SuggestedSource": {
                    "type": "object",
                    "description": "A medium the user does not search yet, with the feed that would add it.",
                    "properties": {
                        "site": {"type": "string", "example": "skysports.com"},
                        "name": {"type": "string", "example": "Sky Sports"},
                        "feed": {"type": "string", "format": "uri", "description": "The feed found for this medium, to send back to POST /feeds/import"},
                        "news": {"type": "integer", "description": "How many news this medium published on the subject (POST /feeds/suggestions only)"},
                        "sample": {"type": "string", "nullable": true, "description": "One headline of the feed, to show what it publishes"},
                        "language": {"type": "string", "description": "POST /feeds/search only"},
                        "readers": {"type": "integer", "description": "How many people follow this feed, as the directory counts them (POST /feeds/search only)"}
                    }
                }
            },
            "securitySchemes": {
                "bearerAuth": {
                    "type": "http",
                    "scheme": "bearer",
                    "bearerFormat": "JWT",
                    "description": "The token answered by POST /login. The user is always read from it, never from the request, so a user can only ever reach their own sources and searches."
                }
            }
        }
    },
    apis: ['./routes/*.js', './controllers/*.js'] // pick up JSDoc in routes/controllers
};

const swaggerSpec = swaggerJSDoc(options);
export default swaggerSpec;