#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"
require_command docker
require_server_config
require_secrets

RETENTION_DAYS="${RETENTION_DAYS:-30}"
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || fail "RETENTION_DAYS must be a whole number."
install -m 700 -d backups
STAMP="$(date +%F_%H%M%S)"
TEMP_DIR="backups/.axora_${STAMP}.partial"
BACKUP_DIR="backups/axora_${STAMP}"
mkdir -m 700 "$TEMP_DIR"
trap 'rm -rf -- "$TEMP_DIR"' EXIT
DB_FILE="$TEMP_DIR/axora.dump"
GLOBALS_FILE="$TEMP_DIR/globals.sql"
UPLOADS_FILE="$TEMP_DIR/uploads.tar.gz"
CADDY_FILE="$TEMP_DIR/caddy_data.tar.gz"

info "Creating PostgreSQL custom-format backup"
compose exec -T db pg_dump --username postgres --dbname axora --format=custom > "$DB_FILE"
compose exec -T db pg_restore --list < "$DB_FILE" >/dev/null

info "Saving database roles, uploaded files, and Caddy's local certificate authority"
compose exec -T db pg_dumpall --username postgres --globals-only --no-role-passwords > "$GLOBALS_FILE"
compose exec -T app tar -C /app/data/uploads -czf - . > "$UPLOADS_FILE"
compose exec -T caddy tar -C /data -czf - . > "$CADDY_FILE"
compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt > "$TEMP_DIR/caddy-root.crt"

{
  printf 'Axora backup\n'
  printf 'Created: %s\n' "$(date --iso-8601=seconds)"
  printf 'Host: %s\n' "$(hostname)"
  printf 'Database format: PostgreSQL custom archive\n'
  printf 'Role passwords included: no\n'
  printf 'App image: axora-app:1.0.0\n'
} > "$TEMP_DIR/manifest.txt"

(cd "$TEMP_DIR" && sha256sum axora.dump globals.sql uploads.tar.gz caddy_data.tar.gz caddy-root.crt manifest.txt > checksums.sha256)
mv "$TEMP_DIR" "$BACKUP_DIR"
trap - EXIT
find backups -mindepth 1 -maxdepth 1 -type d -name 'axora_*' -mtime "+$RETENTION_DAYS" -exec rm -rf -- {} +

info "Backup complete"
printf '%s\n' "$BACKUP_DIR"
printf '\nCopy these files to a separate USB drive or NAS. Same-SSD backups are not enough.\n'
