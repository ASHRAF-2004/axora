#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"
require_command docker
require_server_config
require_secrets

DATABASE_NAME="${AXORA_HYBRID_DB_NAME:-axora_hybrid}"
[[ "$DATABASE_NAME" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] \
  || fail "Database name contains unsupported characters: $DATABASE_NAME"

hybrid_compose() {
  docker compose -f compose.yaml -f compose.hybrid.yaml "$@"
}

info "Applying migrations to hybrid production database $DATABASE_NAME"
hybrid_compose run --rm migrate
bash scripts/server/apply-app-grants.sh "$DATABASE_NAME"
bash scripts/server/validate-hybrid-db.sh "$DATABASE_NAME"
info "Hybrid migrations and application grants are complete"
