#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"
require_command systemctl
require_command docker

SERVICE_FILE="/etc/systemd/system/axora-backup.service"
TIMER_FILE="/etc/systemd/system/axora-backup.timer"
RUN_USER="$(id -un)"

printf '[Unit]\nDescription=Create verified Axora backup\nRequires=docker.service\nAfter=docker.service\n\n[Service]\nType=oneshot\nUser=%s\nWorkingDirectory=%s\nExecStart=/usr/bin/bash %s/scripts/server/backup.sh\n' \
  "$RUN_USER" "$PROJECT_DIR" "$PROJECT_DIR" | sudo tee "$SERVICE_FILE" >/dev/null

printf '[Unit]\nDescription=Run Axora backup every day\n\n[Timer]\nOnCalendar=*-*-* 02:15:00\nPersistent=true\nRandomizedDelaySec=10m\n\n[Install]\nWantedBy=timers.target\n' \
  | sudo tee "$TIMER_FILE" >/dev/null

sudo systemctl daemon-reload
sudo systemctl enable --now axora-backup.timer
systemctl list-timers axora-backup.timer --no-pager
printf '\nDaily backup timer installed. Still copy completed backup folders to a separate USB drive or NAS.\n'
