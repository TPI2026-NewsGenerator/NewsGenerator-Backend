#!/usr/bin/env bash
# Since the BIOS update of 04.11.2026 (M3JKT3AA -> M3JKT47A) the thermal event of the embedded controller, GPE 0x24 (its handler is
# \_GPE._L24 in SSDT1, the Intel thermal framework IETM), fires 160 000 to 340 000 times in the first minutes after each boot, and each
# handler waits 30 s for the controller's buffers (port 0x66, IBDY and OBDY, "AE_AML_LOOP_TIMEOUT"). The old BIOS never did (0 in 6 boots).
# The power-off then waits for these ACPI events to finish (kernel_power_off -> acpi_power_off_prepare -> acpi_os_wait_events_complete,
# poweroff blocked for 122 s at 15:14 on 04.11.2026): the box does not switch off, and hung_task_panic (see stabilise.sh) turns it into
# a panic, a kdump dump (/var/crash/202611041514) and a reboot.
# What this script sets: GPE 0x24 disabled at every boot (srv2-gpe24-off.service) and now, with no reboot. Nothing is lost that worked: the
# handler timed out before it reached the fan routine (FANC) it is written to call, and thermald reads the temperatures by polling.
#   sudo bash mask-gpe24.sh [--check] [--undo]
# --check changes nothing, says what would be done (no sudo needed); --undo enables the GPE again and removes the service.
set -u

CHECK=0; UNDO=0
for arg in "$@"; do
  case "$arg" in --check) CHECK=1 ;; --undo) UNDO=1 ;; *) echo "unknown option $arg"; exit 2 ;; esac
done
[ "$CHECK" = 1 ] || [ "$(id -u)" = 0 ] || { echo "run it with sudo (or with --check)"; exit 1; }

GPE=/sys/firmware/acpi/interrupts/gpe24
UNIT=/etc/systemd/system/srv2-gpe24-off.service
say() { printf '%s\n' "$*"; }
do_it() { if [ "$CHECK" = 1 ]; then say "   would: $*"; else say "   $*"; eval "$@"; fi; }
state() { cat "$GPE" 2>/dev/null | tr -s ' ' || echo "no $GPE"; }

if [ ! -e "$GPE" ]; then say "no $GPE: this box has no GPE 0x24, nothing to do"; exit 1; fi

if [ "$UNDO" = 1 ]; then
  say "== undo"
  say "   now: $(state)"
  do_it "systemctl disable --now srv2-gpe24-off.service 2>/dev/null; true"
  [ -e "$UNIT" ] && do_it "rm -f $UNIT" || say "   $UNIT: not there"
  do_it "echo enable > $GPE; systemctl daemon-reload"
  say "   done, now: $(state)"
  exit 0
fi

say "== disable GPE 0x24"
say "   now: $(state)"
if [ "$CHECK" = 0 ]; then
  cat > "$UNIT" <<'UNITFILE'
[Unit]
Description=Disables the thermal event GPE 0x24 of srv2 (see deploy/srv2/mask-gpe24.sh)
# no ExecStop: enabling it again while the box powers off is what blocked the power-off
DefaultDependencies=no
After=sysinit.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'echo disable > /sys/firmware/acpi/interrupts/gpe24'

[Install]
WantedBy=multi-user.target
UNITFILE
  systemctl daemon-reload
  systemctl enable --now srv2-gpe24-off.service
  say "   set, now: $(state) (kept at every boot)"
else
  say "   would write $UNIT and run: echo disable > $GPE (now and at every boot)"
fi
