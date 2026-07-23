#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"
require_command docker
require_server_config
require_secrets

ARCHIVE="$(resolve_backup_file "${1:-}")"
bash scripts/server/verify-backup.sh "$(dirname "$ARCHIVE")"
compose exec -T db pg_restore --list < "$ARCHIVE" >/dev/null || fail "The archive failed pg_restore validation."

printf '\nDANGER: this replaces the live Axora database.\n'
printf 'Archive: %s\n' "$ARCHIVE"
read -r -p 'Type RESTORE AXORA exactly to continue: ' CONFIRMATION
[[ "$CONFIRMATION" == "RESTORE AXORA" ]] || fail "Restore cancelled."

info "Creating a final pre-restore backup"
bash scripts/server/backup.sh

info "Stopping application writes"
compose stop app
trap 'compose up -d app caddy >/dev/null 2>&1 || true' EXIT

compose exec -T db psql --username postgres --dbname postgres --set=ON_ERROR_STOP=1 --command "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='axora' AND pid <> pg_backend_pid();"
compose exec -T db dropdb --username postgres --if-exists axora
compose exec -T db createdb --username postgres axora
compose exec -T db pg_restore --username postgres --dbname axora --no-owner --no-privileges < "$ARCHIVE"
compose exec -T db psql --username postgres --dbname axora --command "ANALYZE;"
bash scripts/server/migrate.sh

info "Starting Axora and checking health"
compose up -d --wait app caddy
trap - EXIT
bash scripts/server/status.sh
info "Production restore complete"
