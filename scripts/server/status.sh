#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"
require_command docker
require_server_config

info "Container status"
compose ps

info "Database readiness"
compose exec -T db pg_isready --username postgres --dbname axora

info "Application readiness"
compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)}).catch(e=>{console.error(e);process.exit(1)})"

info "Office HTTPS endpoint"
if command -v curl >/dev/null 2>&1; then
  curl --insecure --fail --silent --show-error "https://${AXORA_HOST}/api/health/ready"
  printf '\n'
else
  printf 'curl is not installed; open https://%s in a browser.\n' "$AXORA_HOST"
fi
