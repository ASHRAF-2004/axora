#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"
require_command docker
require_server_config
require_secrets

DATABASE_NAME="${1:-${AXORA_HYBRID_DB_NAME:-axora}}"
[[ "$DATABASE_NAME" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] \
  || fail "Database name contains unsupported characters: $DATABASE_NAME"

info "Applying least-privilege Axora application grants to $DATABASE_NAME"
compose exec -T db psql \
  --username postgres \
  --dbname "$DATABASE_NAME" \
  --file /database/admin/apply-app-grants.sql

info "Verifying the application role can connect and read"
APP_CHECK="$(
  compose exec -T db sh -eu -c '
    export PGPASSWORD="$(cat /run/secrets/axora_app_password)"
    exec psql \
      --host 127.0.0.1 \
      --username axora_app \
      --dbname "$1" \
      --tuples-only \
      --no-align \
      --command "SELECT count(*) >= 1 FROM schema_migrations"
  ' sh "$DATABASE_NAME"
)"
[[ "${APP_CHECK//[[:space:]]/}" == "t" ]] || fail "The axora_app read check failed."

info "Application grants verified"
