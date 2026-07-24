#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"
require_command docker
require_server_config
require_secrets

DATABASE_NAME="${1:-${AXORA_HYBRID_DB_NAME:-axora}}"
[[ "$DATABASE_NAME" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] \
  || fail "Database name contains unsupported characters: $DATABASE_NAME"

hybrid_compose() {
  docker compose -f compose.yaml -f compose.hybrid.yaml "$@"
}

info "Hybrid container status"
hybrid_compose ps db tailscale-db

info "PostgreSQL readiness"
hybrid_compose exec -T db pg_isready --username postgres --dbname "$DATABASE_NAME"

info "Private tunnel status"
hybrid_compose exec -T tailscale-db tailscale status --peers=false
hybrid_compose exec -T tailscale-db tailscale serve status

bash scripts/server/validate-hybrid-db.sh "$DATABASE_NAME"
