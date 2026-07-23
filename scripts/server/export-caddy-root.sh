#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"
require_command docker
require_server_config

info "Exporting only Caddy's public root certificate"
rm -f caddy-root.crt
compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
chmod 644 caddy-root.crt
printf '\nCreated: %s/caddy-root.crt\n' "$PROJECT_DIR"
printf 'Install this public certificate in each approved office PC trusted-root store.\n'
printf 'Never copy files named root.key or intermediate.key.\n'
