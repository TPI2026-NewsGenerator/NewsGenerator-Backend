#!/usr/bin/env bash
# Builds the client, sends it and the code of the server to the machine that stays on and starts them
# there again (see compose.yml). Run from any machine reaching it by ssh:
#
#   bash deploy/deploy.sh
#
# The code replaces ~/newsgenerator/server whole, the API is built again, the other containers are
# started again only when their settings changed. The .env files next to the code and the database
# stay. A change of db/*.sql is not applied by this script: run the file on the database (see README).
# The tunnel of Cloudflare is started when ~/newsgenerator/tunnel.env is there.
set -euo pipefail

HOST="${DEPLOY_HOST:-fabich@192.168.1.135}"
cd "$(dirname "$0")/.."

# the page calls its API on its own address (see deploy/Caddyfile). Git Bash on Windows turns a value
# starting with "/" into a path of Windows ("C:/Program Files/Git/api"): not for these variables
MSYS2_ENV_CONV_EXCL='*' MSYS_NO_PATHCONV=1 VITE_API_URL=/api pnpm --dir ../client run build
if grep -rq 'Program Files' ../client/dist/assets; then
    echo 'The address of the API was turned into a path of Windows, nothing deployed.' >&2
    exit 1
fi
tar -c -C ../client/dist . |
ssh "$HOST" "set -e
    rm -rf ~/newsgenerator/client-dist.new && mkdir -p ~/newsgenerator/client-dist.new
    tar -x -C ~/newsgenerator/client-dist.new
    rm -rf ~/newsgenerator/client-dist.old
    if [ -d ~/newsgenerator/client-dist ]; then mv ~/newsgenerator/client-dist ~/newsgenerator/client-dist.old; fi
    mv ~/newsgenerator/client-dist.new ~/newsgenerator/client-dist"

# the documentation built on this machine (pnpm run docs:build) is served on /docs (see deploy/Caddyfile), for
# the readers signed in only; nothing is sent that names a private address or the hostname all the same; none
# built, /docs stays as it is
if [ -d site ]; then
    if grep -rIqE '192\.168\.|fabianrostello' site; then
        echo 'The site of the docs names a private address or the hostname, nothing deployed.' >&2
        exit 1
    fi
    tar -c -C site . |
    ssh "$HOST" "set -e
        rm -rf ~/newsgenerator/docs-dist.new && mkdir -p ~/newsgenerator/docs-dist.new
        tar -x -C ~/newsgenerator/docs-dist.new
        rm -rf ~/newsgenerator/docs-dist.old
        if [ -d ~/newsgenerator/docs-dist ]; then mv ~/newsgenerator/docs-dist ~/newsgenerator/docs-dist.old; fi
        mv ~/newsgenerator/docs-dist.new ~/newsgenerator/docs-dist"
else
    echo 'No site of the docs built (pnpm run docs:build): /docs left as it is.'
    ssh "$HOST" 'mkdir -p ~/newsgenerator/docs-dist'
fi

# the docs stay on the machine that builds them (pnpm run docs): neither their venv nor the site built
tar -c --exclude=./node_modules --exclude=./generated --exclude=./bench --exclude=./.env \
    --exclude=./.venv-docs --exclude=./site \
    --exclude=./db/create_insert_NewsGenerator.sql . |
ssh "$HOST" "set -e
    rm -rf ~/newsgenerator/server.new && mkdir -p ~/newsgenerator/server.new
    tar -x -C ~/newsgenerator/server.new
    rm -rf ~/newsgenerator/server.old
    if [ -d ~/newsgenerator/server ]; then mv ~/newsgenerator/server ~/newsgenerator/server.old; fi
    mv ~/newsgenerator/server.new ~/newsgenerator/server
    if [ -f ~/newsgenerator/tunnel.env ]; then export COMPOSE_PROFILES=tunnel; fi
    cd ~/newsgenerator/server && docker compose -f deploy/compose.yml up -d --build
    # Caddy reads the folders it was started on: the client and the Caddyfile just replaced
    docker compose -f deploy/compose.yml restart web"
