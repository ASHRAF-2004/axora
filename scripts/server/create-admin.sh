#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"
require_command docker
require_server_config
require_secrets

EMAIL="${1:-}"
DISPLAY_NAME="${2:-}"
[[ -n "$EMAIL" && "$EMAIL" == *@*.* ]] || fail "Usage: bash scripts/server/create-admin.sh admin@company.com \"Admin name\""
[[ -n "$DISPLAY_NAME" ]] || fail "Provide the administrator display name."
[[ -s secrets/admin_initial_password ]] || fail "Missing secrets/admin_initial_password. Run prepare-secrets.sh or create a 14+ character password file with mode 600."

info "Creating or resetting the first Axora administrator"
compose run --rm --no-deps \
  --volume "$PROJECT_DIR/secrets/admin_initial_password:/run/secrets/admin_initial_password:ro" \
  app node server-tools/create-admin.mjs "$EMAIL" "$DISPLAY_NAME"

printf '\nSign in and confirm the account works. Then remove the one-time password file:\n'
printf '  rm secrets/admin_initial_password\n'
