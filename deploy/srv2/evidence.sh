#!/usr/bin/env bash
# Read only. After a freeze of srv2 (the journal of the boot before stops with no shutdown and no error), what the machine
# recorded before it froze (sysstat, every 10 minutes), how its drive and processor are set up, and whether anything can reset it
# when it hangs again:
#   ssh srv2 'bash -s' < server/deploy/srv2/evidence.sh
set +e
section() { printf '\n==== %s\n' "$1"; }

section "the box"
for f in sys_vendor product_name product_version bios_vendor bios_version bios_date; do printf '%-16s %s\n' "$f" "$(cat /sys/class/dmi/id/$f 2>/dev/null)"; done
cat /proc/cmdline

section "how every boot of the journal ended (the last line of each)"
for b in $(journalctl --list-boots --no-pager 2>/dev/null | awk '{print $1}'); do
  printf 'boot %s: ' "$b"; journalctl -b "$b" -n 1 --no-pager -o short-iso 2>/dev/null | tail -1 | cut -c1-120
done

section "the day of the last freeze, as sysstat recorded it (every 10 minutes): the last hour before the log stops"
last_sa=$(ls -t /var/log/sysstat/sa[0-9][0-9] 2>/dev/null | head -1)
for f in /var/log/sysstat/sa03 /var/log/sysstat/sa02; do
  [ -r "$f" ] || continue
  echo "-- $f: processor (%idle, %iowait), the last 8 samples"
  sar -u -f "$f" 2>/dev/null | tail -9
  echo "-- memory and swap"
  sar -r -S -f "$f" 2>/dev/null | tail -12
  echo "-- load and tasks blocked"
  sar -q -f "$f" 2>/dev/null | tail -9
  echo "-- network errors and drops (eno2)"
  sar -n EDEV -f "$f" 2>/dev/null | grep -E 'IFACE|eno2' | tail -6
  break
done

section "the days before: the load and the processor, one line per day (the average, then the peak %system)"
for f in $(ls /var/log/sysstat/sa[0-9][0-9] 2>/dev/null | tail -8); do
  printf '%s  ' "$f"; sar -u -f "$f" 2>/dev/null | awk '/Average/ {print "avg user "$3" system "$5" iowait "$6" idle "$8}'
done

section "crash dumps (kdump keeps one when the kernel panics)"
ls -la /var/crash 2>&1 | head
systemctl is-active kdump-tools 2>&1
grep -E 'crashkernel' /proc/cmdline | head -1

section "can a hang be reset: a watchdog the box has?"
lsmod | grep -i -E 'wdt|iTCO|softdog' || echo "no watchdog module loaded"
dmesg 2>/dev/null | grep -i -E 'wdt|watchdog|tco' | head -8
journalctl -k -b 0 --no-pager 2>/dev/null | grep -i -E 'iTCO|wdt|watchdog|tco' | head -8
ls /lib/modules/$(uname -r)/kernel/drivers/watchdog/ 2>/dev/null | grep -i -E 'itco|wdat|softdog' | head
grep -rn -i -E 'itco|wdt|watchdog' /etc/modprobe.d/ /lib/modprobe.d/ 2>/dev/null | head -6

section "the drive and its power saving (a drive that goes to sleep and does not wake up freezes a box with no log)"
cat /sys/class/nvme/nvme0/model 2>/dev/null
cat /sys/class/nvme/nvme0/firmware_rev 2>/dev/null
cat /sys/module/nvme_core/parameters/default_ps_max_latency_us 2>&1
cat /sys/module/pcie_aspm/parameters/policy 2>&1
journalctl -k -b 0 --no-pager 2>/dev/null | grep -i -E 'nvme.*(reset|timeout|down|abort)|aspm' | head -5

section "the processor's idle states and its limits"
for s in /sys/devices/system/cpu/cpu0/cpuidle/state*; do printf '%s ' "$(cat $s/name)"; done; echo
cat /sys/devices/system/cpu/intel_pstate/status 2>/dev/null
cat /sys/class/powercap/intel-rapl:0/constraint_0_power_limit_uw 2>/dev/null | awk '{printf "PL1 %.0f W\n", $1/1e6}'
cat /sys/class/powercap/intel-rapl:0/constraint_1_power_limit_uw 2>/dev/null | awk '{printf "PL2 %.0f W\n", $1/1e6}'
cat /proc/sys/kernel/nmi_watchdog 2>/dev/null | sed 's/^/nmi_watchdog /'

section "the other things that could have stopped it: power, the session, the cron of the user"
crontab -l 2>&1 | head -5
systemctl list-timers --no-pager 2>/dev/null | head -12
