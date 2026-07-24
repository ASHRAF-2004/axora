#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"
require_command systemctl
require_command docker
require_server_config

SERVICE_FILE="/etc/systemd/system/axora-hybrid-backup.service"
TIMER_FILE="/etc/systemd/system/axora-hybrid-backup.timer"
RUN_USER="$(id -un)"

printf '[Unit]\nDescription=Create verified Axora hybrid database backup\nRequires=docker.service\nAfter=docker.service\n\n[Service]\nType=oneshot\nUser=%s\nWorkingDirectory=%s\nExecStart=/usr/bin/bash %s/scripts/server/hybrid-backup.sh\n' \
  "$RUN_USER" "$PROJECT_DIR" "$PROJECT_DIR" | sudo tee "$SERVICE_FILE" >/dev/null

printf '[Unit]\nDescription=Run Axora hybrid backup every day\n\n[Timer]\nOnCalendar=*-*-* 02:15:00\nPersistent=true\nRandomizedDelaySec=10m\n\n[Install]\nWantedBy=timers.target\n' \
  | sudo tee "$TIMER_FILE" >/dev/null

sudo systemctl daemon-reload
sudo systemctl enable --now axora-hybrid-backup.timer
systemctl list-timers axora-hybrid-backup.timer --no-pager
printf '\nDaily hybrid backup timer installed. Still copy backup folders to a separate encrypted target.\n'
