#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"
require_command docker
require_server_config
require_secrets

DATABASE_NAME="${1:-${AXORA_HYBRID_DB_NAME:-axora}}"
[[ "$DATABASE_NAME" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] \
  || fail "Database name contains unsupported characters: $DATABASE_NAME"

EXPECTED_MIGRATIONS="$(
  find database/migrations \
    -maxdepth 1 \
    -type f \
    -name '[0-9][0-9][0-9]_*.sql' \
    -printf '.' \
    | wc -c
)"

info "Validating hybrid database $DATABASE_NAME"
read -r MIGRATION_COUNT OWNER_COUNT PATH_ONLY_ATTACHMENTS PERMISSIONS_OK < <(
  compose exec -T db psql \
    --username postgres \
    --dbname "$DATABASE_NAME" \
    --tuples-only \
    --no-align \
    --field-separator ' ' \
    --command "
      SELECT
        (SELECT count(*) FROM schema_migrations),
        (SELECT count(*) FROM users WHERE is_owner AND active),
        (SELECT count(*) FROM attachments WHERE file_content IS NULL),
        has_database_privilege('axora_app', current_database(), 'CONNECT')
          AND has_schema_privilege('axora_app', 'public', 'USAGE')
          AND has_table_privilege('axora_app', 'users', 'SELECT')
          AND has_table_privilege('axora_app', 'users', 'UPDATE')
          AND NOT has_table_privilege('axora_app', 'audit_logs', 'INSERT')
          AND NOT has_table_privilege('axora_app', 'schema_migrations', 'UPDATE');
    "
)

[[ "$MIGRATION_COUNT" == "$EXPECTED_MIGRATIONS" ]] \
  || fail "Expected $EXPECTED_MIGRATIONS migrations, found $MIGRATION_COUNT."
[[ "$OWNER_COUNT" -ge 1 ]] || fail "No active protected owner account was found."
[[ "$PATH_ONLY_ATTACHMENTS" == "0" ]] \
  || fail "$PATH_ONLY_ATTACHMENTS attachment(s) have no database content and require manual recovery."
[[ "$PERMISSIONS_OK" == "t" ]] || fail "Application-role permissions are incomplete."

APP_CHECK="$(
  compose exec -T db sh -eu -c '
    export PGPASSWORD="$(cat /run/secrets/axora_app_password)"
    exec psql \
      --host 127.0.0.1 \
      --username axora_app \
      --dbname "$1" \
      --tuples-only \
      --no-align \
      --command "SELECT count(*) FROM users"
  ' sh "$DATABASE_NAME"
)"
[[ "${APP_CHECK//[[:space:]]/}" =~ ^[0-9]+$ ]] \
  || fail "The application role could not query the hybrid database."

compose exec -T db psql \
  --username postgres \
  --dbname "$DATABASE_NAME" \
  --no-align \
  --field-separator ' | ' \
  --command "
    SELECT 'users' AS item, count(*)::text AS value FROM users
    UNION ALL SELECT 'companies', count(*)::text FROM companies
    UNION ALL SELECT 'requests', count(*)::text FROM requests
    UNION ALL SELECT 'attachments', count(*)::text FROM attachments
    UNION ALL SELECT 'attachment bytes', COALESCE(sum(octet_length(file_content)), 0)::text FROM attachments
    UNION ALL SELECT 'audit entries', count(*)::text FROM audit_logs;
  "

info "Hybrid database validation passed"
