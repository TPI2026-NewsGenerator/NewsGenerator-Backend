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
                "name": "News",
                "description": "Operations related to news retrieval and processing"
            },
            {
                "name": "Feeds",
                "description": "Sources added by a user, private to them"
            }
        ],
        "paths": {
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
                                        "category": {"type": "string", "example": "technology"}
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
                    "summary": "Categories of feeds that can be searched",
                    "description": "The categories come from the feeds list (db/rss-links.js): world, press, sport, politics, economy, technology, science.",
                    "responses": {
                        "200": {
                            "description": "List of categories",
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
                            "description": "ISO 639-1 language code.",
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
                }
            }
        }
    },
    apis: ['./routes/*.js', './controllers/*.js'] // pick up JSDoc in routes/controllers
};

const swaggerSpec = swaggerJSDoc(options);
export default swaggerSpec;