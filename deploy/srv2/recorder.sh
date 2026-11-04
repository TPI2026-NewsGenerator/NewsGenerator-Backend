#!/usr/bin/env bash
# srv2 stops with no line in the journal (04.11.2026 04:17, 03.11 11:40, 24.10 22:32) and a watchdog that did not fire: whatever
# stopped it, it was not the kernel. This keeps what the box was doing in its last minutes, on disk, one line every 10 s,
# flushed to the drive each time (the journal is not: it lost the last seconds of every stop). After a stop, the lines before
# the hole say whether it got hot, drew more power, or was quiet when it stopped.
#   sudo bash deploy/srv2/recorder.sh --install      the service srv2-recorder (started at every boot)
#   bash deploy/srv2/recorder.sh --stop-gap          no sudo; the lines before the last hole in the log (on srv2: ssh srv2 'bash -s -- --stop-gap' < recorder.sh)
#   bash deploy/srv2/recorder.sh --once              one line on the screen, nothing written (to try it; the power needs root)
#   sudo bash deploy/srv2/recorder.sh --undo         removes the service (the log stays)
# a line: time, epoch, e=, package temperature, the hottest other sensor, the drive, package power, the limits, mean frequency, load, throttle count
set -u

DIR=/var/log/srv2-recorder
EVERY=10
KEEP_DAYS=14
RAPL=/sys/class/powercap/intel-rapl:0
BIN=/usr/local/sbin/srv2-recorder

nvme_temp_file() {
  local h
  for h in /sys/class/hwmon/hwmon*; do
    [ "$(cat "$h/name" 2>/dev/null)" = nvme ] && { echo "$h/temp1_input"; return; }
  done
}

# one line, from the energy counter of before ($1, in microjoules) and its time ($2, in microseconds); the new ones in E and T
sample() {
  local pkg=0 hot=0 hotn=- z t n nvme='?' w='?' mhz load thr de dt w10
  for z in /sys/class/thermal/thermal_zone*; do
    t=$(( $(cat "$z/temp" 2>/dev/null || echo 0) / 1000 )); n=$(cat "$z/type" 2>/dev/null)
    case $n in
      x86_pkg_temp) pkg=$t ;;
      iwlwifi*|INT3400*) ;;
      *) if [ "$t" -gt "$hot" ]; then hot=$t; hotn=$n; fi ;;
    esac
  done
  [ -n "${NVME:-}" ] && nvme=$(( $(cat "$NVME" 2>/dev/null || echo 0) / 1000 ))
  T=${EPOCHREALTIME/[.,]/}      # the decimal mark follows the locale: a comma on srv2
  E=$(cat $RAPL/energy_uj 2>/dev/null || echo '')
  if [ -n "$E" ] && [ -n "${1:-}" ] && [ -n "${2:-}" ]; then
    de=$(( E - $1 )); [ "$de" -lt 0 ] && de=$(( de + $(cat $RAPL/max_energy_range_uj) ))
    dt=$(( T - $2 )); [ "$dt" -gt 0 ] && { w10=$(( de * 10 / dt )); w="$(( w10 / 10 )).$(( w10 % 10 ))"; }
  fi
  mhz=$(cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq 2>/dev/null | awk '{s+=$1;n++} END{if(n) printf "%d", s/n/1000}')
  load=$(cut -d' ' -f1 /proc/loadavg)
  thr=$(cat /sys/devices/system/cpu/cpu0/thermal_throttle/package_throttle_count 2>/dev/null || echo '?')
  printf '%s e=%s pkg=%s hot=%s(%s) nvme=%s W=%s pl=%s/%s mhz=%s load=%s thr=%s\n' \
    "$(date +%FT%T)" "${T%??????}" "$pkg" "$hot" "$hotn" "$nvme" "$w" \
    "$(( $(cat $RAPL/constraint_0_power_limit_uw 2>/dev/null || echo 0) / 1000000 ))" \
    "$(( $(cat $RAPL/constraint_1_power_limit_uw 2>/dev/null || echo 0) / 1000000 ))" "$mhz" "$load" "$thr"
}

case "${1:-}" in
  --once)
    NVME=$(nvme_temp_file); sample '' ''; exit 0 ;;
  --stop-gap)
    # the last hole longer than a minute in the two latest files: 15 lines before it, the first line after it
    files=$(ls "$DIR"/*.log 2>/dev/null | tail -2)
    [ -n "$files" ] || { echo "no log yet in $DIR"; exit 0; }
    # shellcheck disable=SC2086
    cat $files | awk '
      { split($2, a, "="); e = a[2] + 0; l[NR] = $0; if (NR > 1 && e - p > 60) { g = NR; len = e - p } p = e }
      END {
        if (NR == 0) { print "no log yet"; exit }
        if (!g) { print "no hole longer than a minute in the last two files; the last lines:"; for (i = NR - 14; i <= NR; i++) if (i > 0) print l[i]; exit }
        printf "hole of %d s (%d min) after:\n", len, len / 60
        for (i = g - 15; i < g; i++) if (i > 0) print l[i]
        print "--- hole ---"; print l[g]
      }'
    exit 0 ;;
  --install)
    [ "$(id -u)" = 0 ] || { echo "run it with sudo"; exit 1; }
    install -m 755 "$0" "$BIN"
    mkdir -p "$DIR"
    cat > /etc/systemd/system/srv2-recorder.service <<UNIT
[Unit]
Description=Flight recorder of srv2: temperature, power, frequency every ${EVERY} s, flushed to disk (see deploy/srv2/recorder.sh)

[Service]
ExecStart=$BIN
Restart=always
Nice=10

[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload
    systemctl enable --now srv2-recorder.service
    sleep $(( EVERY + 3 ))
    echo "recording in $DIR (kept $KEEP_DAYS days); the last line:"; tail -n 1 "$DIR"/"$(date +%F)".log
    exit 0 ;;
  --undo)
    [ "$(id -u)" = 0 ] || { echo "run it with sudo"; exit 1; }
    systemctl disable --now srv2-recorder.service 2>/dev/null; rm -f /etc/systemd/system/srv2-recorder.service "$BIN"
    systemctl daemon-reload; echo "removed (the log in $DIR stays)"; exit 0 ;;
  "") ;;
  *) echo "unknown option $1"; exit 2 ;;
esac

mkdir -p "$DIR"
NVME=$(nvme_temp_file)
last_clean=0
E=''; T=''
while :; do
  now=$(date +%s)
  if [ $(( now - last_clean )) -gt 3600 ]; then find "$DIR" -name '*.log' -mtime +"$KEEP_DAYS" -delete; last_clean=$now; fi
  f="$DIR/$(date +%F).log"
  line=$(sample "$E" "$T")      # E and T are the ones sample() sets, kept for the next turn
  E=$(cat $RAPL/energy_uj 2>/dev/null || echo ''); T=${EPOCHREALTIME/[.,]/}
  printf '%s\n' "$line" >> "$f"
  sync -d "$f"
  sleep "$EVERY"
done
