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

# the page calls its API on its own address (see deploy/Caddyfile)
VITE_API_URL=/api pnpm --dir ../client run build
tar -c -C ../client/dist . |
ssh "$HOST" "set -e
    rm -rf ~/newsgenerator/client-dist.new && mkdir -p ~/newsgenerator/client-dist.new
    tar -x -C ~/newsgenerator/client-dist.new
    rm -rf ~/newsgenerator/client-dist.old
    if [ -d ~/newsgenerator/client-dist ]; then mv ~/newsgenerator/client-dist ~/newsgenerator/client-dist.old; fi
    mv ~/newsgenerator/client-dist.new ~/newsgenerator/client-dist"

tar -c --exclude=./node_modules --exclude=./generated --exclude=./bench --exclude=./.env \
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
