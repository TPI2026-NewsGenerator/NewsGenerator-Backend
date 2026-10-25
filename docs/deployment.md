# Deployment

The background work reads the feeds due every minute, day and night: it runs on a machine that stays
on, with the database, in Docker (`deploy/compose.yml`):

| Container | What | Listens on |
|---|---|---|
| `newsgenerator-db` | PostgreSQL 18 + pgvector, 2 GB of `shared_buffers` | the address of the machine, port 5433 |
| `newsgenerator-api` | this server and its background work (`Dockerfile`) | the address of the machine, port 3001 |
| `newsgenerator-web` | Caddy: the client built by `deploy.sh` and `/api` sent to the API, on one address (`deploy/Caddyfile`) | the address of the machine, port 8080, and the tunnel |
| `newsgenerator-tunnel` | the tunnel of Cloudflare to the public hostname, started when the file of its token is there | nothing: it goes out to Cloudflare |
| `newsgenerator-rss-bridge` | RSS-Bridge | the API only (`http://rss-bridge`) |
| `newsgenerator-embedder` | the embedder on the processor (`embedder/Dockerfile`), started apart | the address of the machine, port 8020 |

Nothing listens on the internet: the tunnel goes out to Cloudflare, which ends the https and sends
the public hostname to `http://web:80` (a public hostname of the tunnel, set on the dashboard
of Cloudflare). The page and its API being on one address, the session is a cookie of the site:
`HttpOnly` (no script of the page reads it), `SameSite=Strict` (never sent with a request another
site starts), `Secure` when the reader came through https, valid 7 days and renewed once a day while
used (`services/utils/jwt.js`, `GET` and `DELETE /api/session`). The sign-in allows 10 attempts per
address in 15 minutes: the API reads the address of the reader the tunnel and Caddy forward (`trust
proxy` on private addresses, `app.js`).

Split over two machines, the database on a laptop and the embedder on another, everything stopped
as soon as either one did: on the night of 1.10 the laptop restarted for an update at 3:36, then slept
until noon, and no feed was read for 8 hours. Together on one machine, the graphics card of another
one and of any other machine in `EMBEDDER_URL` work with the embedder of the machine while they are on.

Next to the code, in the folder of the project on the machine, readable by its owner only and never sent with
the code: the settings of the database (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`), the settings of the
API, the `.env` of the server with `DATABASE_URL` to `db:5432` and `RSS_BRIDGE_URL=http://rss-bridge`, and the token
of the tunnel (`TUNNEL_TOKEN`, given by Cloudflare when the tunnel is created).

The site is open to the internet: every data is behind the accounts of the app, and no account is
made unless `SIGNUP_OPEN=1` is in the settings of the API (`POST /signup` answers 403, the page of the signup says
it is closed and the login page links to it no more). Closed, the questions of the AI that write a
profile (`/profile/funnel/*`) need an account too: nobody spends the AI without one. A password of
the whole site came before the accounts: asked by the browser (`basic_auth` of Caddy), an iPhone asked
it again for each font and script of the page, 15 times, and forgot it when Safari closed; then asked
by a page of its own with a cookie of 30 days, a friend still had trouble getting in. Both were taken
out on 9.10.2026.

These files belong to the user running Docker: it refuses one owned by root. The client built is sent
to a folder of the project on the machine.

To send the code and start it again (from any machine reaching it by ssh):

```bash
bash deploy/deploy.sh
```

A change of `db/*.sql` is run by hand on the database, as on the first install. While coding on
another machine, the server run by hand reads the same database (`DATABASE_URL` to the machine,
port 5433) with `INGEST_IN_SERVER=false`: the background work stays on the machine that stays on.

[//]: # ([### 1.3.1. On dev environment)

[//]: # ()
[//]: # (How to get dependencies and build?)

[//]: # (How to run the tests?)

[//]: # ()
[//]: # (### 1.3.2. On integration environment)

[//]: # ()
[//]: # (How to deploy the application outside the dev environment.])


## The documentation on /docs

The documentation site (`pnpm run docs:build`, sent by `deploy.sh` to a folder of the project on the machine) is served by Caddy on
`/docs`, for the readers signed in only: `forward_auth` asks the API (`GET /api/session`, the same check as every route
of the app, so a password changed ends it) and sends the others to `/login`. It is never kept by a shared cache
(`Cache-Control: private, no-cache`). `deploy.sh` refuses to send a site that names a private address or the hostname.
See `deploy/Caddyfile`.
