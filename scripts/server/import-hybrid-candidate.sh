#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"
require_command docker
require_server_config
require_secrets

ARCHIVE="$(resolve_backup_file "${1:-}")"
DATABASE_NAME="${2:-${AXORA_HYBRID_DB_NAME:-axora_hybrid}}"
[[ "$DATABASE_NAME" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] \
  || fail "Database name contains unsupported characters: $DATABASE_NAME"

compose exec -T db pg_restore --list < "$ARCHIVE" >/dev/null \
  || fail "The archive failed PostgreSQL validation."

DATABASE_EXISTS="$(
  compose exec -T db psql \
    --username postgres \
    --dbname postgres \
    --tuples-only \
    --no-align \
    --command "SELECT 1 FROM pg_database WHERE datname='$DATABASE_NAME'"
)"
[[ -z "${DATABASE_EXISTS//[[:space:]]/}" ]] \
  || fail "Database $DATABASE_NAME already exists; refusing to overwrite it."

info "Restoring into new database $DATABASE_NAME"
compose exec -T db createdb --username postgres --template template0 "$DATABASE_NAME"

cleanup_failed_import() {
  compose exec -T db dropdb --username postgres --if-exists "$DATABASE_NAME" >/dev/null 2>&1 || true
}
trap cleanup_failed_import ERR

compose exec -T db pg_restore \
  --username postgres \
  --dbname "$DATABASE_NAME" \
  --no-owner \
  --no-privileges \
  --exit-on-error < "$ARCHIVE"
compose exec -T db psql --username postgres --dbname "$DATABASE_NAME" --command "ANALYZE;"
bash scripts/server/apply-app-grants.sh "$DATABASE_NAME"
bash scripts/server/validate-hybrid-db.sh "$DATABASE_NAME"

trap - ERR
info "Hybrid candidate import passed"
