# NewsGenerator-Backend

## Description

It is a personalizable news generator. <br>
It must be able to read the news, understand it, and summarize the news it has read, taking into account
user parameters such as keywords, desired/undesired topics, language and timeframe of the search.

## Tech Stack

* [Node.js](https://nodejs.org/) [v22.18.0]
* **Server:** [Express](https://expressjs.com/) [v5.2.1]
* **AI Orchestration:** [Ollama](https://ollama.com/)
* **Crawlers:** [Crawlee](https://crawlee.dev/js) [v3.16.0]
* **Parsers:**
    * HTML: [LinkeDOM](https://www.npmjs.com/package/linkedom) [v0.18.12] and [Readability](https://github.com/mozilla/readability) [v0.6.0] to extract content
    * XML: [fast-xml-parser](https://www.npmjs.com/package/fast-xml-parser) [v5.3.5]

## Getting Started

### Prerequisites

List all dependencies and their version needed by the project as :

[//]: # (* DataBase Engine &#40;MySql, PostgreSQL, MSSQL,...&#41;)
* [Node.js](https://nodejs.org/) [v22.18.0]
* IDE used: [IntelliJ](https://www.jetbrains.com/idea/) [v2025.3.3]
* Package manager: [pnpm](https://pnpm.io/fr/) [v10.28.2]
* OS supported: All (web based)

[//]: # (* Virtualization &#40;Docker, .Net, .JDK, .JRE&#41;)

### Configuration
#### Ollama

1. Visit Ollama [website](https://ollama.com/), create an account and create an API Key
under `Settings -> Keys -> Add API Key`

2. Rename `.env.example` to `.env` and insert you api key file:
```
OLLAMA_API_KEY=your_api_key
```

#### Environment
To install dependencies:

```bash
pnpm install
```

To start a development server:

```bash
pnpm run server
```

[//]: # (How to set up the database?)

[//]: # (How do you set the sensitive data?)

## Deployment

To run for production:

```bash
pnpm run build
```

[//]: # ([### 1.3.1. On dev environment)

[//]: # ()
[//]: # (How to get dependencies and build?)

[//]: # (How to run the tests?)

[//]: # ()
[//]: # (### 1.3.2. On integration environment)

[//]: # ()
[//]: # (How to deploy the application outside the dev environment.])

## Directory structure

```shell
├───config
├───controllers
├───db
├───docs
├───routes
├───services
│   ├───storage     // Crawlee storage folder
│   └───utils
└───tests
    ├───data
    └───mock
```

## Collaborate

If you have a suggestion that would make this better, 
please fork the repo and create a pull request. 
You can also simply open an issue with the tag "enhancement". More info on
[how to commit](https://www.conventionalcommits.org/en/v1.0.0/) and [how to use my workflow](https://nvie.com/posts/a-successful-git-branching-model/)

**Propose new feature:**

1. Fork the Project
2. Create your Feature Branch (git checkout -b feature/AmazingFeature)
3. Commit your Changes (git commit -m 'Add some AmazingFeature')
4. Push to the Branch (git push origin feature/AmazingFeature)
5. Open a Pull Request

## License

This project is under [MIT License](https://en.wikipedia.org/wiki/MIT_License). See more under `LICENCE.md`

## Contact

Can contact me on discord: fab2y