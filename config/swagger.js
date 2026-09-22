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
            "/news/topics": {
                "get": {
                    "tags": [
                        "News"
                    ],
                    "summary": "Topics usable in the topics filter",
                    "responses": {
                        "200": {
                            "description": "List of topics",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "topics": {
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
                    "description": "Scrapes the selected news (10 max, like POST /news/content), then asks the AI for a resume of 120 to 150 words. News that could not be scraped (fullContent false) get no resume: summary is null and summaryError explains why.",
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
                        "topics": {
                            "type": "array",
                            "description": "Only news of these topics (given by the AI). All topics if empty. List: GET /news/topics.",
                            "items": {
                                "type": "string"
                            },
                            "example": [
                                "politics",
                                "economy"
                            ]
                        },
                        "undesiredTopics": {
                            "type": "array",
                            "description": "News of these topics are excluded (given by the AI). Same list as topics, a topic can't be in both.",
                            "items": {
                                "type": "string"
                            },
                            "example": [
                                "sport",
                                "culture"
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
                            "description": "Temporal range for the news search.",
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
                            "description": "Topic given by the AI, null while the news is not classified yet."
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