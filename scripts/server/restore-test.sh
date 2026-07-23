#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"
require_command docker
require_server_config
require_secrets

ARCHIVE="$(resolve_backup_file "${1:-}")"
bash scripts/server/verify-backup.sh "$(dirname "$ARCHIVE")"
compose exec -T db pg_restore --list < "$ARCHIVE" >/dev/null || fail "The archive failed pg_restore validation."
TEST_DB="axora_restore_test_$(date +%Y%m%d_%H%M%S)"

cleanup() {
  compose exec -T db dropdb --username postgres --if-exists "$TEST_DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

info "Restoring into temporary database $TEST_DB"
compose exec -T db createdb --username postgres "$TEST_DB"
compose exec -T db pg_restore --username postgres --dbname "$TEST_DB" --no-owner --no-privileges < "$ARCHIVE"

TABLE_COUNT="$(compose exec -T db psql --username postgres --dbname "$TEST_DB" --tuples-only --no-align --command "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")"
[[ "${TABLE_COUNT//[[:space:]]/}" -ge 15 ]] || fail "Restore produced too few tables: $TABLE_COUNT"

info "Restore test passed with ${TABLE_COUNT//[[:space:]]/} public tables"
printf 'The temporary test database will now be removed. Production data was not touched.\n'
