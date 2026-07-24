#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"
require_command docker
require_command jq
require_server_config
require_secrets
for key_file in secrets/tailscale_db_auth_key secrets/tailscale_render_auth_key; do
  [[ -s "$key_file" ]] \
    || fail "Missing $key_file. Run: bash scripts/server/prepare-hybrid-tunnel.sh"
done

hybrid_compose() {
  docker compose -f compose.yaml -f compose.hybrid.yaml "$@"
}

info "Validating hybrid container configuration"
hybrid_compose config --quiet

info "Starting PostgreSQL and its private Tailscale endpoint"
hybrid_compose up -d db tailscale-db --wait

info "Tailscale endpoint status"
hybrid_compose exec -T tailscale-db tailscale status --peers=false
hybrid_compose exec -T tailscale-db tailscale serve status
DB_TAG="$(
  hybrid_compose exec -T tailscale-db tailscale status --json \
    | jq -r '.Self.Tags[]?'
)"
grep -Fxq 'tag:axora-db' <<< "$DB_TAG" \
  || fail "The Ubuntu Tailscale node is missing required tag:axora-db."

info "Ubuntu hybrid endpoint is ready"
