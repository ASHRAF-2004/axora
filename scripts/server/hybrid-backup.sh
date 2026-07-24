#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"
require_command docker
require_server_config
require_secrets

DATABASE_NAME="${1:-${AXORA_HYBRID_DB_NAME:-axora_hybrid}}"
[[ "$DATABASE_NAME" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] \
  || fail "Database name contains unsupported characters: $DATABASE_NAME"

RETENTION_DAYS="${RETENTION_DAYS:-30}"
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || fail "RETENTION_DAYS must be a whole number."

install -m 700 -d backups
STAMP="$(date +%F_%H%M%S)"
TEMP_DIR="backups/.hybrid_${STAMP}.partial"
BACKUP_DIR="backups/hybrid_${STAMP}"
mkdir -m 700 "$TEMP_DIR"
trap 'rm -rf -- "$TEMP_DIR"' EXIT

info "Creating a DB-only hybrid backup of $DATABASE_NAME"
compose exec -T db pg_dump \
  --username postgres \
  --dbname "$DATABASE_NAME" \
  --format=custom \
  --no-owner \
  --no-privileges > "$TEMP_DIR/axora.dump"
compose exec -T db pg_restore --list < "$TEMP_DIR/axora.dump" >/dev/null

{
  printf 'Axora hybrid database backup\n'
  printf 'Created: %s\n' "$(date --iso-8601=seconds)"
  printf 'Host: %s\n' "$(hostname)"
  printf 'Database: %s\n' "$DATABASE_NAME"
  printf 'Attachments: stored inside PostgreSQL\n'
  printf 'Database format: PostgreSQL custom archive\n'
  printf 'Role passwords included: no\n'
} > "$TEMP_DIR/manifest.txt"

(cd "$TEMP_DIR" && sha256sum axora.dump manifest.txt > checksums.sha256)
mv "$TEMP_DIR" "$BACKUP_DIR"
trap - EXIT

find backups \
  -mindepth 1 \
  -maxdepth 1 \
  -type d \
  -name 'hybrid_*' \
  -mtime "+$RETENTION_DAYS" \
  -exec rm -rf -- {} +

info "Hybrid backup complete"
printf '%s\n' "$BACKUP_DIR"
printf 'Copy this folder to a separate encrypted drive or backup target.\n'
