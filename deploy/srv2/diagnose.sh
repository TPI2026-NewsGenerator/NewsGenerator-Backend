#!/usr/bin/env bash
# Read only. srv2 (the worker with the embedder and the tagger) stops answering on the network a few hours after it starts
# (2026-11-02 and 2026-11-03): no ping, no ARP, no ssh, while the user thinks the machine did not crash. Run this right after
# a reboot, from the laptop, to see what the previous boot says about how it ended:
#   ssh srv2 'bash -s' < server/deploy/srv2/diagnose.sh
# Nothing here changes the machine. What needs a privilege it does not have, it says.
set +e

section() { printf '\n==== %s\n' "$1"; }
trouble='hang|reset|timeout|link is down|link up|e1000|igc|r8169|thermal|throttl|oom|out of memory|killed process|mce|machine check|watchdog|soft lockup|hard lockup|blocked for more than|segfault|panic|i/o error|nvme|ata[0-9]|network is unreachable|carrier'

section "this boot"
uptime -s; uptime
last -x -n 14 2>/dev/null | head -16

section "boots the journal knows (a journal that is not kept leaves only this one)"
journalctl --list-boots --no-pager 2>&1 | tail -5
ls -ld /var/log/journal 2>&1
grep -rhE '^\s*Storage' /etc/systemd/journald.conf /etc/systemd/journald.conf.d 2>/dev/null

section "the last lines of the previous boot (how it ended)"
journalctl -b -1 -n 50 --no-pager 2>&1 | tail -50

section "the previous boot: what looks like trouble"
journalctl -b -1 --no-pager 2>&1 | grep -i -E "$trouble" | tail -60

section "the same in the files of /var/log, kept by rsyslog"
for f in /var/log/kern.log.1 /var/log/kern.log /var/log/syslog.1 /var/log/syslog; do
  [ -r "$f" ] && { echo "-- $f"; grep -i -E "$trouble" "$f" | tail -25; } || echo "-- $f: not readable or absent"
done

section "the network card"
ip -br link
ip -br addr
cat /etc/netplan/*.yaml 2>/dev/null
lspci 2>/dev/null | grep -i -E 'ethernet|network'
for n in $(ls /sys/class/net | grep -v -E '^(lo|docker|veth|br-)'); do
  echo "-- $n"
  ethtool -i "$n" 2>&1 | grep -E 'driver|version|firmware'
  ethtool "$n" 2>&1 | grep -E 'Speed|Duplex|Link detected'
  ethtool -k "$n" 2>&1 | grep -E '^(tcp-segmentation-offload|generic-segmentation-offload|generic-receive-offload):'
  ethtool --show-eee "$n" 2>&1 | grep -E 'EEE status'
done

section "memory, swap, processor"
free -h
swapon --show
lscpu | grep -E 'Model name|^CPU\(s\)|Thread|Core|Socket'

section "heat"
(sensors 2>/dev/null || for z in /sys/class/thermal/thermal_zone*; do echo "$(cat $z/type): $(( $(cat $z/temp) / 1000 )) C"; done) 2>&1 | head -20

section "what runs, and how much it takes"
docker ps --format 'table {{.Names}}\t{{.Status}}'
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' 2>&1 | head
docker inspect -f '{{.Name}} cpus={{.HostConfig.NanoCpus}} shares={{.HostConfig.CpuShares}} memory={{.HostConfig.Memory}} restart={{.HostConfig.RestartPolicy.Name}}' newsgenerator-embedder newsgenerator-ner 2>&1

section "watchdog and what the kernel does on a hang"
ls -l /dev/watchdog* 2>&1
grep -hE '^(RuntimeWatchdogSec|ShutdownWatchdogSec)' /etc/systemd/system.conf /etc/systemd/system.conf.d/*.conf 2>/dev/null
sysctl kernel.panic kernel.softlockup_panic kernel.hung_task_panic kernel.hung_task_timeout_secs 2>&1

section "disk"
df -h / 2>&1 | tail -2
