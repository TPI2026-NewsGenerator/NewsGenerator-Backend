#!/usr/bin/env bash
# Sends the code of the server to the machine that stays on and starts it there again (see
# compose.yml). Run from any machine reaching it by ssh:
#
#   bash deploy/deploy.sh
#
# The code replaces ~/newsgenerator/server whole, the API is built again, the other containers are
# started again only when their settings changed. The .env files next to the code and the database
# stay. A change of db/*.sql is not applied by this script: run the file on the database (see README).
set -euo pipefail

HOST="${DEPLOY_HOST:-fabich@192.168.1.135}"
cd "$(dirname "$0")/.."

tar -c --exclude=./node_modules --exclude=./generated --exclude=./bench --exclude=./.env \
    --exclude=./db/create_insert_NewsGenerator.sql . |
ssh "$HOST" "set -e
    rm -rf ~/newsgenerator/server.new && mkdir -p ~/newsgenerator/server.new
    tar -x -C ~/newsgenerator/server.new
    rm -rf ~/newsgenerator/server.old
    if [ -d ~/newsgenerator/server ]; then mv ~/newsgenerator/server ~/newsgenerator/server.old; fi
    mv ~/newsgenerator/server.new ~/newsgenerator/server
    cd ~/newsgenerator/server && docker compose -f deploy/compose.yml up -d --build"
