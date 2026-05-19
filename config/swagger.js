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
            }
        },
        "components": {
            "schemas": {
                "NewsRequest": {
                    "type": "object",
                    "properties": {
                        "keywords": {
                            "type": "array",
                            "description": "Terms to include in the search.",
                            "items": {
                                "type": "string"
                            },
                            "example": [
                                "trump"
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
                        "undesiredTopics": {
                            "type": "array",
                            "description": "Topics to explicitly exclude from results.",
                            "items": {
                                "type": "string"
                            },
                            "example": [
                                "politics",
                                "celebrity gossip"
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
                        "articles": {
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
                        "content": {
                            "type": "string",
                            "description": "The raw news content."
                        },
                        "summary": {
                            "type": "string",
                            "description": "The personalized summary generated by the AI if requested."
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