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
            },
            {
                "name": "Profile",
                "description": "What a user wants to read, in their own words, split into interests by the AI, and the sources found for it"
            },
            {
                "name": "Briefing",
                "description": "The stories of the last 48 hours chosen for the profile, read, summarized and counted"
            }
        ],
        // every route but /login and /signup needs the session cookie they set
        "security": [{"cookieAuth": []}],
        "paths": {
            "/login": {
                "post": {
                    "tags": ["Login"],
                    "summary": "Sign in: the session is set in an HttpOnly cookie",
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
                            "description": "The user; the browser keeps the `session` cookie and sends it with every request to /api",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "id_user": {"type": "integer"}
                                        }
                                    }
                                }
                            }
                        },
                        "400": {"description": "Username or password missing"},
                        "429": {"description": "More than 10 attempts from this address in 15 minutes"},
                        "401": {"description": "Wrong password"},
                        "404": {"description": "No such user"}
                    }
                }
            },
            "/session": {
                "get": {
                    "tags": ["Login"],
                    "summary": "The signed in user, read from the session cookie",
                    "responses": {
                        "200": {
                            "description": "The user",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "id": {"type": "integer"},
                                            "username": {"type": "string"},
                                            "email": {"type": "string"},
                                            "role": {"type": "integer"}
                                        }
                                    }
                                }
                            }
                        },
                        "403": {"description": "No session, or an expired one"}
                    }
                },
                "delete": {
                    "tags": ["Login"],
                    "summary": "Sign out: the session cookie is removed",
                    "security": [],
                    "responses": {"204": {"description": "Signed out"}}
                }
            },
            "/account/username": {
                "put": {
                    "tags": ["Login"],
                    "summary": "Change the username of the signed in user",
                    "description": "Asks the current password. The session cookie starts again with the new name. At most 10 changes per address in 15 minutes, with the ones of the password.",
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "username": {"type": "string", "example": "lecteur.2", "description": "3 to 30 letters, digits, dots, dashes or underscores"},
                                        "password": {"type": "string", "description": "The current password"}
                                    },
                                    "required": ["username", "password"]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": {"description": "The user as the session tells it: {id, username, email, role}"},
                        "400": {"description": "Not a username"},
                        "401": {"description": "Not the current password"},
                        "403": {"description": "No session, or an expired one"},
                        "409": {"description": "Used by another account, whatever its case"},
                        "429": {"description": "Too many changes tried"}
                    }
                }
            },
            "/account/email": {
                "put": {
                    "tags": ["Login"],
                    "summary": "Change the email of the signed in user",
                    "description": "Asks the current password. The briefings are sent to it when no other address is given. The session cookie starts again with the new email. At most 10 changes per address in 15 minutes, with the ones of the username and the password.",
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "email": {"type": "string", "example": "lecteur@example.org"},
                                        "password": {"type": "string", "description": "The current password"}
                                    },
                                    "required": ["email", "password"]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": {"description": "The user as the session tells it: {id, username, email, role}"},
                        "400": {"description": "Not an email"},
                        "401": {"description": "Not the current password"},
                        "403": {"description": "No session, or an expired one"},
                        "409": {"description": "Used by another account, whatever its case"},
                        "429": {"description": "Too many changes tried"}
                    }
                }
            },
            "/account/password": {
                "put": {
                    "tags": ["Login"],
                    "summary": "Change the password of the signed in user",
                    "description": "Asks the current password. The sessions opened before, on the other devices, are refused from then on (403); the one of this device starts again. At most 10 changes per address in 15 minutes, with the ones of the username.",
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "password": {"type": "string", "description": "The current password"},
                                        "newPassword": {"type": "string", "description": "10 to 72 bytes"}
                                    },
                                    "required": ["password", "newPassword"]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": {"description": "The user as the session tells it: {id, username, email, role}"},
                        "400": {"description": "A new password too short, too long, or the current one"},
                        "401": {"description": "Not the current password"},
                        "403": {"description": "No session, or an expired one"},
                        "429": {"description": "Too many changes tried"}
                    }
                }
            },
            "/signup": {
                "post": {
                    "tags": ["Login"],
                    "summary": "Create an account with its profile, and sign in",
                    "description": "The profile is required: nothing is read for a reader without it. It is split into interests by the AI **before** the account is created, so a text with no interest leaves no account behind (422). Then the account is created, the profile saved, and its sources are searched in background as after `PUT /profile`. At most 5 requests per address and hour.",
                    "security": [],
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "username": {"type": "string", "example": "lecteur", "description": "3 to 30 letters, digits, dots, dashes or underscores, unique whatever its case"},
                                        "email": {"type": "string", "format": "email", "description": "Unique whatever its case"},
                                        "password": {"type": "string", "format": "password", "description": "10 to 72 characters"},
                                        "text": {"type": "string", "description": "The profile in the reader's words, 20 to 2000 characters"},
                                        "languages": {"type": "array", "items": {"type": "string"}, "example": ["fr", "en"]}
                                    },
                                    "required": ["username", "email", "password", "text", "languages"]
                                }
                            }
                        }
                    },
                    "responses": {
                        "201": {
                            "description": "The account, signed in as by POST /login (the `session` cookie)",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "id_user": {"type": "integer"}
                                        }
                                    }
                                }
                            }
                        },
                        "400": {"description": "A field is missing or invalid"},
                        "409": {"description": "The username or the email is already used"},
                        "422": {"description": "No interest could be read in the profile"},
                        "429": {"description": "Too many accounts created from this address"}
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
                    "summary": "Search a directory of feeds by name or site, or the media publishing on a subject",
                    "description": "`from: directory` asks a public directory for the feeds whose name matches (\"premier league\") or of a site, the most read first (about 1 s). The directory only reads the names of the feeds, so `from: web` asks Google News for the media that published on these words in the last 30 days, with the feed found for each (20 to 45 s). The client asks both at once and shows them in one list. The media this user already searches are left out. Nothing is checked here: the feeds are read when they are imported.",
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "query": {"type": "string", "example": "premier league"},
                                        "language": {"type": "string", "example": "fr", "description": "The language of the media looked for on Google News, 'en' by default"},
                                        "from": {"type": "string", "enum": ["directory", "web"], "default": "directory"}
                                    },
                                    "required": ["query"]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": {
                            "description": "Feeds of the directory, or of the media found on the web",
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
                        "400": {"description": "No subject given, or an unknown `from`"}
                    }
                }
            },
            "/feeds/check": {
                "post": {
                    "tags": ["Feeds"],
                    "summary": "Check the sites of a list the reader imports",
                    "description": "The client reads the file of the reader (CSV, Excel, OPML or text) and sends its addresses 25 at most at a time. For each one the feed is found as for a site added by hand, and its status says what keeps it out: `ready` (a feed with news of these days), `bridge` (no feed, read through our RSS-Bridge, in its own limit), `asleep` (fewer than 3 news in 7 days), `flood` (more than 300 news at once: a flood or an archive, the reader decides), `added` (already a source of theirs), `none`. Nothing is added: the chosen ones go to POST /feeds/import. 40 requests per hour per address.",
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "sites": {"type": "array", "maxItems": 25, "items": {"type": "string", "example": "https://www.kicker.de"}},
                                        "language": {"type": "string", "example": "en", "description": "Steers which section of a site is read when its feed has to be built from the page."}
                                    },
                                    "required": ["sites"]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": {
                            "description": "One answer per site",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "sites": {
                                                "type": "array",
                                                "items": {
                                                    "type": "object",
                                                    "properties": {
                                                        "site": {"type": "string"},
                                                        "status": {"type": "string", "enum": ["ready", "bridge", "asleep", "flood", "added", "none"]},
                                                        "name": {"type": "string"},
                                                        "feed": {"type": "string", "format": "uri"},
                                                        "language": {"type": "string", "nullable": true},
                                                        "recent": {"type": "integer", "description": "news of the last 7 days"},
                                                        "items": {"type": "integer", "description": "news in the feed at once"},
                                                        "sample": {"type": "string", "nullable": true},
                                                        "reason": {"type": "string", "description": "why nothing was found"}
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        "400": {"description": "No site, or more than 25"},
                        "429": {"description": "Past the sites checked per hour: 2000 per account, 4000 per address, counted in sites. {error, retryAfter}: the seconds until these can be checked (also in the Retry-After header)"}
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
                },
                "patch": {
                    "tags": ["Feeds"],
                    "summary": "Trust or share one of the sources added by hand, or not",
                    "description": "`trusted`: among the stories already close to the profile, the ones a trusted source tells get a bonus in the briefing, the AI that chooses is told so, and its article leads the card. It changes nothing to the corroboration.\n\n`shared`: the source can be recommended to the other readers whose interests it publishes on (GET /feeds/recommended). A source added by hand is never recommended without it. Refused when its address looks like it holds a private key (`?key=`, `?token=`, a long random part...).\n\nOnly for the sources added by hand.",
                    "parameters": [{"name": "id", "in": "path", "required": true, "schema": {"type": "integer"}}],
                    "requestBody": {"required": true, "content": {"application/json": {"schema": {"type": "object", "properties": {"trusted": {"type": "boolean"}, "shared": {"type": "boolean"}}}}}},
                    "responses": {"200": {"description": "{id, trusted, shared}"}, "400": {"description": "Neither trusted nor shared given, or an address that can't be shared"}, "404": {"description": "Not a source added by hand by this user"}}
                }
            },
            "/feeds/recommended": {
                "get": {
                    "tags": ["Feeds"],
                    "summary": "Sources this reader could add",
                    "description": "Among the feeds the server already reads for the other readers, only the ones read for a **public reason**: found by the discovery of a profile, or shared by the reader who added them. A feed another reader only added by hand is never a candidate. Kept: the ones with at least 3 news of the last 7 days on the interests of this reader, in their languages, without the media they already read and the sources their thumbs left out. Then the AI reads up to 12 titles of each the vectors put on the interests, and a feed is kept on the ones it confirms (its answer kept a day per feed, the interests unchanged). The most relevant first, 20 at most.",
                    "responses": {
                        "200": {
                            "description": "The recommended sources",
                            "content": {"application/json": {"schema": {"type": "object", "properties": {"sources": {"type": "array", "items": {
                                "type": "object",
                                "properties": {
                                    "id": {"type": "integer", "description": "Of the feed, to send back to POST /feeds/recommended"},
                                    "site": {"type": "string", "example": "goal.com"},
                                    "url": {"type": "string", "nullable": true, "description": "null for a site read through the RSS-Bridge of the project"},
                                    "category": {"type": "string"},
                                    "language": {"type": "string", "nullable": true},
                                    "news": {"type": "integer", "description": "Its news of the last 7 days in the languages of the reader"},
                                    "relevant": {"type": "integer", "description": "How many of them are on the interests of the reader, in the share the AI confirmed"},
                                    "samples": {"type": "array", "items": {"type": "string"}, "description": "The titles closest to them, among the ones the AI confirmed"}
                                }
                            }}}}}}
                        }
                    }
                },
                "post": {
                    "tags": ["Feeds"],
                    "summary": "Add recommended sources",
                    "description": "Only ids are sent: each is checked to be recommended to this reader right now, so every address added is one the server already reads, never one the client names. They are added as if by hand: counted in the limit of 800, never removed without the reader, and not shared.",
                    "requestBody": {"required": true, "content": {"application/json": {"schema": {"type": "object", "properties": {"ids": {"type": "array", "items": {"type": "integer"}, "maxItems": 20}}, "required": ["ids"]}}}},
                    "responses": {
                        "200": {"description": "{feeds, errors}: the sources added, and why the others were not ({id, site, error})"},
                        "400": {"description": "No id, or more than 20"}
                    }
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
            "/news/translations": {
                "post": {
                    "tags": ["News"],
                    "summary": "The news found, translated into the language of the search",
                    "description": "A search reads every language: the client asks for the cards the reader reaches. The titles and descriptions of 'news', and the titles only of 'titles' (the facts of an affair), are translated by the AI when they are written in another language than 'language'. Only news of the cache. A translation that lost a figure of its text is not given; a text is translated once per language.",
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "news": {"type": "array", "maxItems": 30, "items": {"type": "string", "format": "uri"}},
                                        "titles": {"type": "array", "maxItems": 60, "items": {"type": "string", "format": "uri"}},
                                        "language": {"type": "string", "enum": ["en", "fr", "es", "de", "it"], "example": "fr"}
                                    },
                                    "required": ["language"]
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": {
                            "description": "{translations: [{url, language, title, description}]}: only the news with a translation; language is the one they are written in, description null when not asked or not translated."
                        },
                        "400": {"description": "No url, too many, an url not found in the news cache, or an unknown language"},
                        "403": {"description": "Invalid or expired token"}
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
            },
            "/profile": {
                "get": {
                    "tags": ["Profile"],
                    "summary": "The profile of the user, its interests and the sources found for it",
                    "responses": {"200": {"description": "The profile, null before the user wrote one", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ProfileResponse"}}}}}
                },
                "put": {
                    "tags": ["Profile"],
                    "summary": "Write the profile",
                    "description": "The AI splits the text into 1 to 6 interests, each gets its bge-m3 vector, and the sources of the profile are found again in background (discovery.status 'running' until done). Needs the embedder (pnpm run embedder).",
                    "requestBody": {
                        "required": true,
                        "content": {"application/json": {"schema": {
                            "type": "object",
                            "properties": {
                                "text": {"type": "string", "minLength": 20, "maxLength": 2000, "example": "Je suis passionné de rugby (Top 14, Six Nations). J'aime aussi la mode. Pas de football."},
                                "languages": {"type": "array", "items": {"type": "string"}, "example": ["fr", "en"]}
                            },
                            "required": ["text", "languages"]
                        }}}
                    },
                    "responses": {
                        "200": {"description": "The profile written", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ProfileResponse"}}}},
                        "400": {"description": "Text too short or too long, or unknown language"},
                        "422": {"description": "The AI read no interest in the text"},
                        "503": {"description": "The embedder does not answer"}
                    }
                }
            },
            "/profile/options": {
                "get": {
                    "tags": ["Profile"],
                    "summary": "The languages a profile can choose",
                    "security": [],
                    "responses": {"200": {"description": "{languages: [...]}"}}
                }
            },
            "/profile/interests/{id}": {
                "patch": {
                    "tags": ["Profile"],
                    "summary": "Correct one interest",
                    "parameters": [{"name": "id", "in": "path", "required": true, "schema": {"type": "integer"}}],
                    "requestBody": {"content": {"application/json": {"schema": {"type": "object", "properties": {
                        "text": {"type": "string", "maxLength": 300},
                        "weight": {"type": "number", "minimum": 0.5, "maximum": 1}
                    }}}}},
                    "responses": {"200": {"description": "The profile"}, "400": {"description": "Invalid text or weight"}, "404": {"description": "Not an interest of this user"}}
                },
                "delete": {
                    "tags": ["Profile"],
                    "summary": "Remove one interest",
                    "parameters": [{"name": "id", "in": "path", "required": true, "schema": {"type": "integer"}}],
                    "responses": {"200": {"description": "The profile"}, "404": {"description": "Not an interest of this user"}}
                }
            },
            "/profile/kept-sources": {
                "post": {
                    "tags": ["Profile"],
                    "summary": "Keep a source the thumbs left out",
                    "description": "A source found for the profile is left out once at least 3 of its cards were refused, twice as often as liked (GET /profile gives them in refusedSources). Kept, it comes back and is never left out again.",
                    "requestBody": {"required": true, "content": {"application/json": {"schema": {"type": "object", "properties": {"url": {"type": "string"}}}}}},
                    "responses": {"200": {"description": "The profile"}, "400": {"description": "url missing"}, "404": {"description": "This source is not left out"}}
                }
            },
            "/profile/discover": {
                "post": {
                    "tags": ["Profile"],
                    "summary": "Find the sources of the profile again",
                    "description": "In background. Replaces the sources found before, never the ones the user added by hand.",
                    "responses": {"200": {"description": "The profile, discovery.status 'running'"}, "400": {"description": "No profile yet"}}
                }
            },
            "/briefing": {
                "get": {
                    "tags": ["Briefing"],
                    "summary": "The last briefing of the user",
                    "responses": {"200": {"description": "{briefing: Briefing | null}", "content": {"application/json": {"schema": {"type": "object", "properties": {"briefing": {"$ref": "#/components/schemas/Briefing"}}}}}}}
                },
                "post": {
                    "tags": ["Briefing"],
                    "summary": "Write a new briefing",
                    "description": "In background: answers the briefing running, GET /briefing until its status is 'ready' or 'failed'. One at a time per user. A story already shown can be chosen again; two stories telling the same news are one card.\n\n`hours`: of news it is written from, 48 when not given. A briefing of 168 hours (the week) gives one card per affair followed over the days, and prefers the news told by several media.",
                    "requestBody": {"required": false, "content": {"application/json": {"schema": {"type": "object", "properties": {"hours": {"type": "integer", "enum": [24, 48, 168], "default": 48}}}}}},
                    "responses": {"202": {"description": "{briefing: Briefing} running"}, "400": {"description": "hours is not 24, 48 or 168"}}
                }
            },
            "/briefing/{id}/vote": {
                "post": {
                    "tags": ["Briefing"],
                    "summary": "Give a thumb to a card",
                    "description": "'up': good for me, 'down': not for me, null: taken back. The titles of the last 30 days guide the AI that chooses the next briefings, and a source found for the profile whose cards are refused at least 3 times (twice as often as liked) is left out. The sources added by hand are never left out.",
                    "parameters": [{"name": "id", "in": "path", "required": true, "schema": {"type": "integer"}}],
                    "requestBody": {"required": true, "content": {"application/json": {"schema": {"type": "object", "properties": {"storyId": {"type": "integer"}, "vote": {"type": "string", "enum": ["up", "down"], "nullable": true}}}}}},
                    "responses": {"204": {"description": "Saved"}, "400": {"description": "storyId or vote wrong"}, "404": {"description": "No such card in a ready briefing of this user"}}
                }
            },
            "/briefing/{id}/email": {
                "post": {
                    "tags": ["Briefing"],
                    "summary": "Send the cards of a briefing the reader ticked by e-mail",
                    "description": "Through the SMTP account of the server (SMTP_USER, SMTP_PASS), to the address `to`, else to the one of the account. The cards in the order of storyIds (the reader can change it), each once, laid out as the page shows them. Sent to another address than the account one, it says who sends it and the answers go to the account address. At most 10 e-mails an hour per address and 30 a day per account.",
                    "parameters": [{"name": "id", "in": "path", "required": true, "schema": {"type": "integer"}}],
                    "requestBody": {"required": true, "content": {"application/json": {"schema": {"type": "object", "required": ["storyIds"], "properties": {
                        "storyIds": {"type": "array", "items": {"type": "integer"}, "minItems": 1},
                        "to": {"type": "string", "description": "One address; the one of the account when not given"},
                        "pictures": {"type": "object", "description": "The picture of some cards, by storyId: null takes it out, {url} puts an image of the web (http/https, a public host; the mail client of the receiver loads it, credited to the medium when it is one of the story, see /stories/{storyId}/pictures), {data} a JPEG, PNG, GIF or WebP file in base64 (2 MB each, 6 MB in all), joined to the e-mail. A card not named keeps its own.",
                            "additionalProperties": {"nullable": true, "oneOf": [{"type": "object", "properties": {"url": {"type": "string"}}}, {"type": "object", "properties": {"data": {"type": "string", "format": "byte"}}}]},
                            "example": {"12": null, "15": {"url": "https://cdn.example/photo.jpg"}}}
                    }}}}},
                    "responses": {
                        "204": {"description": "Sent"},
                        "400": {"description": "storyIds not a list of cards, to not an email, no address, or a picture that is not an image of the web or an image file under its weight"},
                        "404": {"description": "No such ready briefing of this user, or none of the cards in it"},
                        "429": {"description": "Too many e-mails in the hour or the day"},
                        "502": {"description": "The mail server refused it"},
                        "503": {"description": "The server has no e-mail account"}
                    }
                }
            },
            "/briefing/{id}/stories/{storyId}/pictures": {
                "get": {
                    "tags": ["Briefing"],
                    "summary": "The pictures of a card the reader can put in an e-mail",
                    "description": "The picture of the card first, then the ones the feeds gave the articles of its story, once each, with the medium of each.",
                    "parameters": [{"name": "id", "in": "path", "required": true, "schema": {"type": "integer"}}, {"name": "storyId", "in": "path", "required": true, "schema": {"type": "integer"}}],
                    "responses": {
                        "200": {"description": "{pictures: [{url, source}]}"},
                        "404": {"description": "No such ready briefing of this user, or no such card in it"}
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
                            "description": "ISO 639-1 language code of the language the cards are shown in. A search reads the feeds of every language; a sentence gets its candidates from the news in this language and from the news in the others, each its own share. The cards in another language carry it (language), POST /news/translations gives their translation. GET /news/categories answers the ones that can be chosen.",
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
                            "description": "News language, read on its page (only in POST /news/content)."
                        },
                        "language": {
                            "type": "string",
                            "nullable": true,
                            "description": "The language the news is written in (POST /news): another one than the language searched is translated with POST /news/translations."
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
                        "story": {"type": "integer", "nullable": true, "description": "The story of the background work this news is in (only in POST /news), null for a news in none."},
                        "thread": {"type": "integer", "nullable": true, "description": "The thread (the affair followed over days) of its story (only in POST /news), null when it has none."},
                        "facts": {
                            "type": "array",
                            "description": "Only in POST /news: the facts of the affair of this card in time order, this news among them (a preview, the result, the reactions; see db/add_threads.sql). The facts found by the search have found true; the others are read from the feeds of this reader only, and carry corroboration.media alone. Each can be asked for its key passages with its url and the urls of its sources. One item when the news is in no thread.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "url": {"type": "string", "format": "uri"},
                                    "title": {"type": "string"},
                                    "source": {"type": "string"},
                                    "publishedAt": {"type": "string", "format": "date-time"},
                                    "found": {"type": "boolean", "description": "Found by the search, or only part of the same affair"},
                                    "match": {"type": "string", "nullable": true, "enum": ["answer", "related"]},
                                    "corroboration": {"type": "object"},
                                    "sources": {"type": "array", "items": {"type": "object"}}
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
                "ProfileResponse": {
                    "type": "object",
                    "properties": {
                        "profile": {"type": "object", "nullable": true, "properties": {
                            "text": {"type": "string"},
                            "language": {"type": "string", "example": "fr", "description": "The language the news are shown in"},
                            "refused": {"type": "array", "items": {"type": "string"}, "example": ["le football féminin"], "description": "What the reader says they do not want, as the AI read it in the text: never an interest, the briefing leaves it out"},
                            "discovery": {"type": "object", "properties": {
                                "status": {"type": "string", "enum": ["idle", "running", "done", "failed"]},
                                "error": {"type": "string", "nullable": true},
                                "at": {"type": "string", "format": "date-time", "nullable": true}
                            }}
                        }},
                        "interests": {"type": "array", "items": {"type": "object", "properties": {
                            "id": {"type": "integer"},
                            "text": {"type": "string", "example": "Rugby : Top 14, Six Nations, transferts"},
                            "weight": {"type": "number", "example": 1},
                            "keywords": {"type": "string", "example": "rugby, Top 14, XV de France"},
                            "sections": {"type": "array", "items": {"type": "string"}},
                            "category": {"type": "string", "example": "sport"}
                        }}},
                        "sources": {"type": "array", "items": {"type": "object", "properties": {
                            "id": {"type": "integer"}, "site": {"type": "string"}, "url": {"type": "string"},
                            "category": {"type": "string"}, "language": {"type": "string"}, "error": {"type": "string", "nullable": true}
                        }}}
                    }
                },
                "Briefing": {
                    "type": "object",
                    "nullable": true,
                    "properties": {
                        "id": {"type": "integer"},
                        "status": {"type": "string", "enum": ["running", "ready", "failed"]},
                        "step": {"type": "string", "nullable": true, "enum": ["starting", "ranking", "choosing", "checking", "reading", "summarizing"]},
                        "error": {"type": "string", "nullable": true},
                        "hours": {"type": "integer", "enum": [24, 48, 168], "description": "Of news it was written from"},
                        "createdAt": {"type": "string", "format": "date-time"},
                        "items": {"type": "array", "items": {"type": "object", "properties": {
                            "storyId": {"type": "integer"},
                            "title": {"type": "string"},
                            "why": {"type": "string", "description": "Why the AI chose it for this user"},
                            "interest": {"type": "string", "nullable": true, "description": "The interest it is closest to"},
                            "summary": {"type": "string", "nullable": true, "description": "Neutral summary of one article read, null when none could be read"},
                            "topic": {"type": "string", "nullable": true},
                            "sourcing": {"type": "string", "nullable": true, "enum": ["named", "anonymous", "none"]},
                            "hedged": {"type": "string", "nullable": true, "description": "The words the article used to say it has no confirmation"},
                            "thumbnail": {"type": "string", "nullable": true},
                            "publishedAt": {"type": "string", "format": "date-time"},
                            "corroboration": {"type": "object", "properties": {
                                "media": {"type": "integer", "description": "Media telling the story"},
                                "read": {"type": "integer", "description": "Media whose text could be read"},
                                "independent": {"type": "integer", "description": "Texts written apart from the others among the ones read"},
                                "agencies": {"type": "array", "items": {"type": "string"}, "example": ["AFP"]},
                                "mediaNames": {"type": "array", "items": {"type": "string"}}
                            }},
                            "lead": {"type": "object", "description": "The article of the title and of the passages, the one the card sends to read (absent from the briefings made before 02.10.2026)", "properties": {
                                "title": {"type": "string"}, "url": {"type": "string"}, "source": {"type": "string"}, "publishedAt": {"type": "string"}, "trusted": {"type": "boolean"}
                            }},
                            "articles": {"type": "array", "items": {"type": "object", "properties": {
                                "title": {"type": "string"}, "url": {"type": "string"}, "source": {"type": "string"}, "publishedAt": {"type": "string"}, "trusted": {"type": "boolean"}
                            }}}
                        }}}
                    }
                },
                "SuggestedSource": {
                    "type": "object",
                    "description": "A medium the user does not search yet, with the feed that would add it.",
                    "properties": {
                        "site": {"type": "string", "example": "skysports.com"},
                        "name": {"type": "string", "example": "Sky Sports"},
                        "feed": {"type": "string", "format": "uri", "description": "The feed found for this medium, to send back to POST /feeds/import"},
                        "news": {"type": "integer", "description": "How many news this medium published on the subject (POST /feeds/suggestions, and POST /feeds/search from web)"},
                        "sample": {"type": "string", "nullable": true, "description": "One headline of the feed, to show what it publishes"},
                        "language": {"type": "string", "description": "POST /feeds/search only"},
                        "readers": {"type": "integer", "description": "How many people follow this feed, as the directory counts them (POST /feeds/search from directory only)"},
                        "via": {"type": "string", "enum": ["directory", "web"], "description": "POST /feeds/search only: where it was found"}
                    }
                }
            },
            "securitySchemes": {
                "cookieAuth": {
                    "type": "apiKey",
                    "in": "cookie",
                    "name": "session",
                    "description": "The token set by POST /login, in an HttpOnly cookie the page cannot read, valid 7 days and renewed once a day while used. The user is always read from it, never from the request, so a user can only ever reach their own sources and searches."
                }
            }
        }
    },
    apis: ['./routes/*.js', './controllers/*.js'] // pick up JSDoc in routes/controllers
};

const swaggerSpec = swaggerJSDoc(options);
export default swaggerSpec;