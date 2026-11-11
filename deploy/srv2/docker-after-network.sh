#!/usr/bin/env bash
# srv2 started with its two containers (the embedder and the tagger) down on 04.11.2026 13:39. Its Ethernet link gained
# carrier 2 min 38 s after the boot (eno2 "Gained carrier" 13:41:59, systemd-networkd-wait-online gave up at 13:41:21), and
# docker started the containers at 13:41:22, with no address on the box: their ports are published on its address (-p
# 192.168.1.183:8020:8020, see ~/migration/worker-run.sh) and the bind failed ("cannot assign requested address", "failed to set up
# container networking"). The containers started by hand after that ran with no network attached at all (docker inspect: Networks
# {}, nothing listening), a restart did not change it: only worker-run.sh, which creates them again, did.
# What this script sets: docker waits, before it starts, until the box has an address with a route out (10 minutes at most, it then
# starts anyway), and says in the journal how long it waited (journalctl -u docker | grep srv2-wait-for-ip): the slow links of
# the next boots are then known. docker.service has TimeoutStartSec=0, nothing cuts the wait.
#   sudo bash docker-after-network.sh [--check] [--undo]
# --check changes nothing, says what would be done (no sudo needed); --undo takes back what this script wrote. Nothing is
# restarted: it works from the next boot on.
set -u

CHECK=0; UNDO=0
for arg in "$@"; do
  case "$arg" in --check) CHECK=1 ;; --undo) UNDO=1 ;; *) echo "unknown option $arg"; exit 2 ;; esac
done
[ "$CHECK" = 1 ] || [ "$(id -u)" = 0 ] || { echo "run it with sudo (or with --check)"; exit 1; }

WAIT=/usr/local/sbin/srv2-wait-for-ip
DROPIN_DIR=/etc/systemd/system/docker.service.d
DROPIN=$DROPIN_DIR/10-srv2-wait-for-network.conf
say() { printf '%s\n' "$*"; }
do_it() { if [ "$CHECK" = 1 ]; then say "   would: $*"; else say "   $*"; eval "$@"; fi; }
address() { ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}'; }

if [ "$UNDO" = 1 ]; then
  say "== undo"
  for f in "$DROPIN" "$WAIT"; do
    [ -e "$f" ] && do_it "rm -f $f" || say "   $f: not there"
  done
  do_it "rmdir $DROPIN_DIR 2>/dev/null; systemctl daemon-reload"
  say "   done: docker starts without waiting from the next boot on"
  exit 0
fi

say "== 1. the script docker waits on"
say "   now: address $(address || true)"
if [ "$CHECK" = 0 ]; then
  cat > "$WAIT" <<'SCRIPT'
#!/bin/sh
# Waits until the box has an IPv4 address with a route out, the address the containers publish their ports on (see
# deploy/srv2/docker-after-network.sh). 10 minutes at most: docker starts anyway, a box without network still has to serve.
PATH=/usr/sbin:/sbin:/usr/bin:/bin
start=$(date +%s)
while :; do
  ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')
  waited=$(( $(date +%s) - start ))
  if [ -n "$ip" ]; then echo "srv2-wait-for-ip: address $ip after $waited s"; exit 0; fi
  if [ "$waited" -ge 600 ]; then echo "srv2-wait-for-ip: no address after $waited s, docker starts anyway"; exit 0; fi
  sleep 2
done
SCRIPT
  chmod 755 "$WAIT"
  say "   written: $WAIT"
else
  say "   would write $WAIT: waits for an address with a route out, 10 minutes at most, says how long it waited"
fi

say "== 2. docker runs it before it starts"
if [ "$CHECK" = 0 ]; then
  mkdir -p "$DROPIN_DIR"
  cat > "$DROPIN" <<'CONF'
# docker starts after the box has an address (see deploy/srv2/docker-after-network.sh)
[Service]
ExecStartPre=/usr/local/sbin/srv2-wait-for-ip
CONF
  systemctl daemon-reload
  say "   written: $DROPIN ($(systemctl show docker -p ExecStartPre --value | grep -c srv2-wait-for-ip) line read by systemd), works from the next boot"
else
  say "   would write $DROPIN (ExecStartPre of docker.service), now: $([ -e "$DROPIN" ] && echo there || echo 'not there'); TimeoutStartSec=$(systemctl show docker -p TimeoutStartUSec --value)"
fi
