#!/usr/bin/env bash
# srv2 (Lenovo ThinkCentre M70q Gen 2, i7-11700T) froze twice under the work of the embedder and the tagger: the journal of the
# boot before stops with no shutdown and no error (2026-10-24 22:32, 2026-11-03 11:40), at a moment the load was low (see
# evidence.sh). What this script sets, from what the box showed (03.11.2026):
#   1. the power limits of the processor: a part made for 35 W may draw 115 W for short bursts (PL2, the BIOS's) in a 1-litre box
#      with a small adapter; the long limit (PL1) read 65 W, then 35 W a few minutes later (thermald moves it). The work of the
#      embedder (AVX-512, bursts every 20 minutes) is the heaviest load such a box has, and the box froze at the end of a quiet
#      stretch, when the next burst was due. Short limit back to 45 W, long to 35 W, its design power
#   2. the kernel panics on a hang instead of staying frozen: the dump is kept (kdump is active) and the box restarts by itself
#   3. the hardware watchdog (iTCO_wdt, blacklisted by Ubuntu with all the others), so that a box frozen for good is reset by the
#      chipset, the user not being next to it: systemd feeds it, a frozen box stops feeding it
#   4. with --kernel: no deep sleep state of the NVMe drive (a WD SN740) nor of the processor, which freeze boxes with no log; this
#      one needs a reboot
#   sudo bash deploy/srv2/stabilise.sh [--check] [--kernel] [--undo]
# --check changes nothing, says what would be done (no sudo needed); --undo takes back what this script wrote.
set -u

CHECK=0; KERNEL=0; UNDO=0
for arg in "$@"; do
  case "$arg" in --check) CHECK=1 ;; --kernel) KERNEL=1 ;; --undo) UNDO=1 ;; *) echo "unknown option $arg"; exit 2 ;; esac
done
[ "$CHECK" = 1 ] || [ "$(id -u)" = 0 ] || { echo "run it with sudo (or with --check)"; exit 1; }

PL1_UW=35000000   # long term, the design power of an i7-11700T
PL2_UW=45000000   # short term
RAPL=/sys/class/powercap/intel-rapl:0
say() { printf '%s\n' "$*"; }
do_it() { if [ "$CHECK" = 1 ]; then say "   would: $*"; else say "   $*"; eval "$@"; fi; }

if [ "$UNDO" = 1 ]; then
  say "== undo"
  for f in /etc/systemd/system/srv2-power-limits.service /etc/sysctl.d/90-srv2-hang.conf /etc/modules-load.d/srv2-watchdog.conf \
           /etc/systemd/system.conf.d/90-srv2-watchdog.conf /etc/default/grub.d/90-srv2-stability.cfg; do
    [ -e "$f" ] && do_it "rm -f $f" || say "   $f: not there"
  done
  do_it "systemctl disable srv2-power-limits.service 2>/dev/null; systemctl daemon-reload; update-grub >/dev/null 2>&1; true"
  say "   done: the power limits and the sysctl go back at the next boot, the grub lines too"
  exit 0
fi

say "== 1. power limits of the processor"
if [ -d "$RAPL" ]; then
  say "   now: PL1 $(( $(cat $RAPL/constraint_0_power_limit_uw) / 1000000 )) W (thermald moves it), PL2 $(( $(cat $RAPL/constraint_1_power_limit_uw) / 1000000 )) W (the BIOS's)"
  if [ "$CHECK" = 0 ]; then
    cat > /etc/systemd/system/srv2-power-limits.service <<UNIT
[Unit]
Description=Power limits of the processor of srv2 (35 W / 45 W, see deploy/srv2/stabilise.sh)
After=sysinit.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'echo $PL1_UW > $RAPL/constraint_0_power_limit_uw; echo $PL2_UW > $RAPL/constraint_1_power_limit_uw'

[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload
    systemctl enable --now srv2-power-limits.service
    say "   set: PL1 $(( $(cat $RAPL/constraint_0_power_limit_uw) / 1000000 )) W, PL2 $(( $(cat $RAPL/constraint_1_power_limit_uw) / 1000000 )) W (kept at every boot)"
  else
    say "   would write PL1 $((PL1_UW / 1000000)) W and PL2 $((PL2_UW / 1000000)) W now and at every boot (srv2-power-limits.service); writable: $([ -w $RAPL/constraint_0_power_limit_uw ] && echo yes || echo 'only as root')"
  fi
else
  say "   no $RAPL: the processor's limits are not readable here, skipped"
fi

say "== 2. the kernel panics on a hang, and the box restarts"
if [ "$CHECK" = 0 ]; then
  cat > /etc/sysctl.d/90-srv2-hang.conf <<'CONF'
# a hang becomes a panic: kdump keeps the dump, then the box restarts 10 s later (see deploy/srv2/stabilise.sh)
kernel.panic = 10
kernel.panic_on_oops = 1
kernel.softlockup_panic = 1
kernel.hardlockup_panic = 1
kernel.hung_task_panic = 1
kernel.hung_task_timeout_secs = 120
CONF
  sysctl --system >/dev/null && say "   set: $(sysctl -n kernel.panic kernel.hardlockup_panic kernel.hung_task_panic | tr '\n' ' ')"
else
  say "   would write /etc/sysctl.d/90-srv2-hang.conf: panic after 10 s, on oops, soft and hard lockups, tasks hung 120 s (now kernel.panic=$(sysctl -n kernel.panic))"
fi

say "== 3. hardware watchdog"
if ls /lib/modules/"$(uname -r)"/kernel/drivers/watchdog/iTCO_wdt.ko* >/dev/null 2>&1; then
  if [ "$CHECK" = 0 ]; then
    if modprobe iTCO_wdt 2>&1 && [ -e /dev/watchdog0 ]; then
      echo iTCO_wdt > /etc/modules-load.d/srv2-watchdog.conf
      mkdir -p /etc/systemd/system.conf.d
      printf '[Manager]\nRuntimeWatchdogSec=30s\nRebootWatchdogSec=2min\n' > /etc/systemd/system.conf.d/90-srv2-watchdog.conf
      systemctl daemon-reexec
      say "   set: /dev/watchdog0 ($(cat /sys/class/watchdog/watchdog0/identity 2>/dev/null)), fed by systemd every 30 s: a frozen box is reset by the chipset"
    else
      say "   the chipset gives no watchdog (the BIOS turned its reset off: $(dmesg | grep -i -E 'iTCO|wdt' | tail -1)). A box frozen for good will still need the power button"
      rmmod iTCO_wdt 2>/dev/null
    fi
  else
    say "   would load iTCO_wdt (not loaded now: Ubuntu blacklists every watchdog) and have systemd feed /dev/watchdog0 every 30 s, if the BIOS allows the reset"
  fi
else
  say "   no iTCO_wdt in this kernel: skipped"
fi

if [ "$KERNEL" = 1 ]; then
  say "== 4. no deep sleep states (needs a reboot)"
  do_it "mkdir -p /etc/default/grub.d"
  if [ "$CHECK" = 0 ]; then
    printf 'GRUB_CMDLINE_LINUX_DEFAULT="$GRUB_CMDLINE_LINUX_DEFAULT nvme_core.default_ps_max_latency_us=0 intel_idle.max_cstate=1"\n' > /etc/default/grub.d/90-srv2-stability.cfg
    update-grub 2>&1 | tail -2
    say "   set: takes effect at the next reboot (now: $(cat /sys/module/nvme_core/parameters/default_ps_max_latency_us) us for the drive)"
  else
    say "   would add nvme_core.default_ps_max_latency_us=0 and intel_idle.max_cstate=1 to the kernel line (/etc/default/grub.d/90-srv2-stability.cfg)"
  fi
else
  say "== 4. (not asked) no deep sleep states: rerun with --kernel, it needs a reboot"
fi

say "== done"
